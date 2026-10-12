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
	const matchesValue = (await realpath(git.stdout.trim())) !== root;
	if (matchesValue) {
		throw new Error(
			"DLC は単一の Git ワークスペースのルートで初期化してください。",
		);
	}
	for (const directory of ["memory", "knowledge", "intents"]) {
		await files.directory(`.nerita/dlc/spaces/default/${directory}`);
	}
	const result = await new WorkspaceScanner(files, signal).detect();
	const matchesSameDetection = !sameDetection(
		await files.read(".nerita/dlc/workspace.json"),
		result,
	);
	if (matchesSameDetection) {
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
	/** 検出のファイルアクセスを許可済みルートへ限定し、親の取消しを走査へ伝える。 */
	constructor(
		private files: SafeDlcFiles,
		private signal: AbortSignal,
	) {}
	/** 取消し・走査深さ・件数・読取り量・経過時間を確認し、上限を超えた検出結果は採用しない。 */
	private budget(depth = 0): void {
		this.signal.throwIfAborted();
		const matchesDepth =
			depth > detectionLimits.depth ||
			this.visited > detectionLimits.files ||
			this.bytes > detectionLimits.bytes;
		if (matchesDepth) {
			throw new Error("ワークスペース検出の走査上限を超えています。");
		}
		if (Date.now() - this.started > detectionLimits.durationMs) {
			throw new Error("ワークスペース検出の走査上限を超えています。");
		}
	}
	/** 総読取り量の残りを上限にし、未作成も含めた入力を指紋の計算へ記録する。 */
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
	/** 決めた順でファイルを走査し、除外領域を避けてリンクと実体ルート外への逸脱を拒否する。 */
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

			if (stat.isSymbolicLink()) {
				throw new Error(
					`リンクを含むワークスペースを検出できません: ${name}`,
				);
			}
			const actualPath = await realpath(resolve(this.files.root, name));
			if (!containsPath(this.files.root, actualPath)) {
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
	/** pnpm のパッケージ指定を読み、絶対パスと親・ドライブへの参照を拒否する。 */
	private async patterns(): Promise<string[] | null> {
		const workspace = await this.read("pnpm-workspace.yaml");
		if (workspace === undefined) {
			return null;
		}
		const patterns = z
			.object({ packages: z.array(z.string().min(1)) })
			.parse(parseYaml(workspace)).packages;
		const matchesSome = patterns.some((pattern) => {
			const invalidPattern =
				pattern.startsWith("/") ||
				pattern.includes("..") ||
				pattern.includes("\\");
			return invalidPattern || pattern.includes(":");
		});
		if (matchesSome) {
			throw new Error("ワークスペースのパッケージ指定が不正です。");
		}
		return patterns;
	}
	/** 対象パッケージのマニフェストだけから構成を抽出し、検出中に消えた入力を黙って省略しない。 */
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
			const matchesPatterns =
				patterns !== null &&
				projectRoot !== "." &&
				!selectedPackage(projectRoot, patterns);
			if (matchesPatterns) {
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
	/** 設定とソースの名前から言語の根拠を集め、表示用の根拠数を制限する。 */
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
	/** 未確定の場合だけロックファイルから管理方式を補い、各ファイルの存在も指紋へ記録する。 */
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
	/** 走査と読取りを完了してから検出契約を検証し、同じ入力を照合できる指紋を付ける。 */
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
