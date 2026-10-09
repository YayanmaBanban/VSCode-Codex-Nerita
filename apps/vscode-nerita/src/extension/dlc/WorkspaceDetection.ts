// 上限付きの読み取りだけで構造を検出する。Git の差分やスクリプトの実行は検出に含めない。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
	WorkspaceDetectionSchema,
	type WorkspaceDetection,
} from "@nerita/dlc/workspace";
import { containsPath } from "../security/AgentAccessPolicy";
import { type SafeDlcFiles, jsonDigest } from "./SafeDlcFiles";
import {
	manifestSchema,
	languageNames,
	configLanguages,
	packageManagers,
	lockManagers,
	declaredFrameworks,
	classification,
	packageRoot,
	selectedPackage,
} from "./DetectionFacts";

const execute = promisify(execFile);
export const detectionLimits = {
	files: 10000,
	depth: 12,
	bytes: 8 * 1024 * 1024,
	durationMs: 30000,
} as const;
const excluded = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
	"target",
	".venv",
	".next",
	".vscode-test",
	".pnpm-store",
	".turbo",
	".cache",
	".pytest_cache",
	"__pycache__",
	".codex",
	".pi",
	".nerita",
	".env",
	".aws",
	".ssh",
]);

/** 読み取り不能・上限超過を部分成功にせず、以前の workspace.json を保持する。 */
export async function initializeWorkspace(
	files: SafeDlcFiles,
	signal: AbortSignal,
): Promise<WorkspaceDetection> {
	await files.path(".nerita/dlc");
	const root = await realpath(files.root);
	const git = await execute(
		"git",
		["-C", root, "rev-parse", "--show-toplevel"],
		{
			signal,
			windowsHide: true,
			timeout: detectionLimits.durationMs,
			maxBuffer: 1024 * 1024,
		},
	);
	if ((await realpath(git.stdout.trim())) !== root) {
		throw new Error(
			"DLC は単一の Git ワークスペースのルートで初期化してください。",
		);
	}
	for (const directory of ["memory", "knowledge", "intents"]) {
		await files.directory(`.nerita/dlc/spaces/default/${directory}`);
	}
	const result = await new WorkspaceScanner(files, signal).detect();
	if (
		!sameDetection(await files.read(".nerita/dlc/workspace.json"), result)
	) {
		await files.write(".nerita/dlc/workspace.json", result);
	}
	return result;
}
function sameDetection(
	text: string | undefined,
	result: WorkspaceDetection,
): boolean {
	if (text === undefined) {
		return false;
	}
	try {
		return (
			JSON.stringify(WorkspaceDetectionSchema.parse(JSON.parse(text))) ===
			JSON.stringify(result)
		);
	} catch {
		return false;
	}
}

/** 同じ入力から同じフィンガープリントを得る。ソース本文や秘密情報は保存しない。 */
class WorkspaceScanner {
	private started = Date.now();
	private visited = 0;
	private bytes = 0;
	private inputs = new Map<string, unknown>();
	private names: string[] = [];
	constructor(
		private files: SafeDlcFiles,
		private signal: AbortSignal,
	) {}
	private budget(depth = 0): void {
		this.signal.throwIfAborted();
		if (
			depth > detectionLimits.depth ||
			this.visited > detectionLimits.files ||
			this.bytes > detectionLimits.bytes ||
			Date.now() - this.started > detectionLimits.durationMs
		) {
			throw new Error("ワークスペース検出の走査上限を超えています。");
		}
	}
	private async read(path: string): Promise<string | undefined> {
		this.budget();
		const text = await this.files.read(
			path,
			detectionLimits.bytes - this.bytes,
		);
		this.bytes += text === undefined ? 0 : Buffer.byteLength(text);
		this.inputs.set(path, text ?? null);
		this.budget();
		return text;
	}
	private async walk(path: string, depth: number): Promise<void> {
		this.budget(depth);
		const target =
			path === "" ? this.files.root : await this.files.path(path);
		const entries = await readdir(target, { withFileTypes: true });
		this.visited += entries.length;
		this.budget(depth);
		for (const entry of entries.sort((a, b) =>
			a.name.localeCompare(b.name, "en"),
		)) {
			if (excluded.has(entry.name) || entry.name.startsWith(".env")) {
				continue;
			}
			const name = path === "" ? entry.name : `${path}/${entry.name}`;
			const stat = await lstat(resolve(this.files.root, name));
			if (
				stat.isSymbolicLink() ||
				!containsPath(
					this.files.root,
					await realpath(resolve(this.files.root, name)),
				)
			) {
				throw new Error(
					`リンクを含むワークスペースを検出できません: ${name}`,
				);
			}
			if (stat.isDirectory()) {
				await this.walk(name, depth + 1);
			} else if (stat.isFile()) {
				this.names.push(name);
			}
		}
	}
	private async patterns(): Promise<string[] | null> {
		const workspace = await this.read("pnpm-workspace.yaml");
		if (workspace === undefined) {
			return null;
		}
		const patterns = z
			.object({ packages: z.array(z.string().min(1)) })
			.parse(parseYaml(workspace)).packages;
		if (
			patterns.some(
				(pattern) =>
					pattern.startsWith("/") ||
					pattern.includes("..") ||
					pattern.includes("\\") ||
					pattern.includes(":"),
			)
		) {
			throw new Error("ワークスペースのパッケージ指定が不正です。");
		}
		return patterns;
	}
	private async projectFacts(patterns: string[] | null) {
		const projects: WorkspaceDetection["projects"] = [];
		const frameworks: WorkspaceDetection["frameworks"] = [];
		const scripts: WorkspaceDetection["declaredScripts"] = [];
		let packageManager: WorkspaceDetection["layout"]["packageManager"] =
			patterns !== null ? "pnpm" : "unknown";
		for (const path of this.names.filter(
			(name) => name.split("/").at(-1) === "package.json",
		)) {
			const projectRoot = packageRoot(path);
			if (
				patterns !== null &&
				projectRoot !== "." &&
				!selectedPackage(projectRoot, patterns)
			) {
				continue;
			}
			const content = await this.read(path);
			if (content === undefined) {
				throw new Error(
					`検出中にマニフェストがなくなりました: ${path}`,
				);
			}
			const manifest = manifestSchema.parse(JSON.parse(content));
			projects.push({
				root: projectRoot,
				name: manifest.name ?? projectRoot,
				manifest: path,
			});
			packageManager = declaredManager(
				projectRoot,
				manifest.packageManager,
				packageManager,
			);
			frameworks.push(...declaredFrameworks(path, projectRoot, manifest));
			scripts.push({
				projectRoot,
				source: path,
				names: Object.keys(manifest.scripts ?? {}).sort(),
			});
		}
		return {
			projects: projects.sort((a, b) =>
				a.root.localeCompare(b.root, "en"),
			),
			frameworks: frameworks.sort((a, b) => {
				const order = a.projectRoot.localeCompare(b.projectRoot, "en");
				return order === 0 ? a.name.localeCompare(b.name, "en") : order;
			}),
			declaredScripts: scripts.sort((a, b) =>
				a.projectRoot.localeCompare(b.projectRoot, "en"),
			),
			packageManager,
		};
	}
	private async languageFacts() {
		const languages = new Map<string, string[]>();
		const sources: string[] = [];
		for (const name of this.names) {
			const basename = name.split("/").at(-1) ?? "";
			const language =
				configLanguages[basename] ??
				languageNames[basename.split(".").at(-1) ?? ""];
			if (language === undefined) {
				continue;
			}
			if (configLanguages[basename] !== undefined) {
				await this.read(name);
			} else {
				sources.push(name);
			}
			languages.set(language, [...(languages.get(language) ?? []), name]);
		}
		return {
			sources,
			languages: [...languages.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, evidence]) => ({
					name,
					evidence: evidence.sort().slice(0, 20),
				})),
		};
	}
	private lockManager(
		manager: WorkspaceDetection["layout"]["packageManager"],
	): WorkspaceDetection["layout"]["packageManager"] {
		for (const [lock, value] of Object.entries(lockManagers)) {
			if (manager === "unknown" && this.names.includes(lock)) {
				manager = value;
			}
			this.inputs.set(`exists:${lock}`, this.names.includes(lock));
		}
		return manager;
	}
	async detect(): Promise<WorkspaceDetection> {
		await this.walk("", 0);
		this.names.sort();
		this.inputs.set("file-list", this.names);
		const patterns = await this.patterns();
		const facts = await this.projectFacts(patterns);
		const { sources, languages } = await this.languageFacts();
		const submodules = await this.read(".gitmodules");
		const packageManager = this.lockManager(facts.packageManager);
		const evidence = [
			...sources.slice(0, 10),
			...facts.projects.map((project) => project.manifest),
		];
		if (submodules !== undefined) {
			evidence.push(".gitmodules");
		}
		return WorkspaceDetectionSchema.parse({
			schemaVersion: 1,
			kind: "workspace-detection",
			detectorVersion: 1,
			classification: {
				detected: classification(this.names, evidence),
				evidence: evidence.sort(),
			},
			repository: {
				vcs: "git",
				root: ".",
				submodules: submodules !== undefined,
			},
			layout: {
				kind:
					patterns !== null || facts.projects.length > 1
						? "monorepo"
						: "single",
				definition: patterns !== null ? "pnpm-workspace.yaml" : null,
				packageManager,
			},
			projects: facts.projects,
			frameworks: facts.frameworks,
			declaredScripts: facts.declaredScripts,
			languages,
			practices: this.names.filter((name) =>
				/(?:^|\/)(?:AGENTS\.md|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.prettierrc[^/]*|biome\.json)$/u.test(
					name,
				),
			),
			scan: {
				status: "complete",
				inputFingerprint: jsonDigest({
					detectorVersion: 1,
					inputs: [...this.inputs.entries()].sort(([a], [b]) =>
						a.localeCompare(b),
					),
				}),
				warnings: [],
			},
		});
	}
}

function declaredManager(
	root: string,
	declared: string | undefined,
	current: WorkspaceDetection["layout"]["packageManager"],
): WorkspaceDetection["layout"]["packageManager"] {
	if (root !== "." || declared === undefined) {
		return current;
	}
	return packageManagers.parse(declared.split("@")[0]);
}
