// 外部パッケージのコードを実行せず、エージェント定義だけを読み込む。
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { containsPath } from "../../security/AgentAccessPolicy";
import { subagentFiles } from "./PiSubagentFiles";

const metadataSchema = z.object({
	name: z.string().min(1).max(80),
	description: z.string().max(2000),
	tools: z.union([z.string(), z.array(z.string())]).optional(),
	model: z.string().optional(),
	aliases: z.union([z.string(), z.array(z.string())]).optional(),
	systemPromptMode: z.enum(["append", "replace"]).optional(),
	runner: z.unknown().optional(),
	thinking: z
		.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
		.optional(),
});
/** 定義の本文と出所は起動時に固定し、承認中には読み直さない。 */
export type PiSubagentDefinition = Omit<
	z.infer<typeof metadataSchema>,
	"tools" | "aliases" | "runner"
> & {
	tools?: string[];
	aliases?: string[];
	unavailableReason?: string;
	prompt: string;
	source: "extension" | "user" | "project";
};

/** 導入済みパッケージと明示された entry から、データの置き場所を求める。 */
export async function loadSubagentDefinitions(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settings: PiSdk.SettingsManager,
	trusted: string[],
) {
	const entries = await Promise.all(trusted.map((entry) => realpath(entry)));
	const candidates = packageCandidates(sdk, cwd, agentDir, settings, trusted);
	const packages: string[] = [];
	for (const candidate of candidates) {
		try {
			const metadata: unknown = JSON.parse(
				await readFile(join(candidate, "package.json"), "utf8"),
			);
			if (
				z
					.object({ name: z.literal("pi-subagents") })
					.safeParse(metadata).success
			) {
				packages.push(await realpath(candidate));
			}
		} catch {
			/* 未導入のパッケージは自動取得しない。 */
		}
	}
	const definitions: PiSubagentDefinition[] = [];
	for (const directory of new Set(packages)) {
		definitions.push(
			...(await readDefinitions(
				sdk,
				join(directory, "agents"),
				"extension",
				directory,
			)),
		);
	}
	definitions.push(
		...(await readDefinitions(
			sdk,
			join(agentDir, "agents"),
			"user",
			agentDir,
		)),
	);
	if (settings.isProjectTrusted()) {
		definitions.push(
			...(await readDefinitions(
				sdk,
				join(cwd, ".pi/agents"),
				"project",
				cwd,
			)),
		);
	}
	return {
		definitions,
		// 既知の独立 CLI 拡張はロードせず、Host の同名 Tool に置き換える。
		trusted: entries.filter(
			(entry) => !packages.some((root) => containsPath(root, entry)),
		),
	};
}

/** リンクによるディレクトリ外への読取りと、過大な定義を拒否する。 */
async function readDefinitions(
	sdk: typeof PiSdk,
	directory: string,
	source: PiSubagentDefinition["source"],
	base: string,
) {
	let root: string;
	try {
		root = await realpath(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
	if (!containsPath(await realpath(base), root)) {
		throw new Error("サブエージェント定義のディレクトリが範囲外です。");
	}
	const definitions: PiSubagentDefinition[] = [];
	for (const file of await subagentFiles(root)) {
		if (!containsPath(root, file) || (await stat(file)).size > 65536) {
			throw new Error(
				"サブエージェント定義の範囲またはサイズが不正です。",
			);
		}
		const parsed = sdk.parseFrontmatter<Record<string, unknown>>(
			await readFile(file, "utf8"),
		);
		const metadata = metadataSchema.parse(parsed.frontmatter);
		const { tools, aliases, runner, ...rest } = metadata;
		definitions.push({
			...rest,
			prompt: parsed.body,
			source,
			...(aliases === undefined ? {} : { aliases: words(aliases) }),
			...(runner === undefined
				? {}
				: {
						unavailableReason:
							"外部 runner は Nerita では非対応です。",
					}),
			...(tools === undefined
				? {}
				: {
						tools: words(tools),
					}),
		});
	}
	return definitions;
}

/** SDK の設定済み導入先だけを参照し、ネットワークから取得しない。 */
function packageCandidates(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settings: PiSdk.SettingsManager,
	trusted: string[],
) {
	const manager = new sdk.DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager: settings,
	});
	const candidates = trusted.map((entry) => dirname(entry));
	for (const [scope, config] of [
		["user", settings.getGlobalSettings()],
		["project", settings.getProjectSettings()],
	] as const) {
		if (scope === "project" && !settings.isProjectTrusted()) {
			continue;
		}
		for (const entry of (config.packages ?? []).filter(
			(entry) =>
				typeof entry === "string" || entry.extensions?.length !== 0,
		)) {
			const source = typeof entry === "string" ? entry : entry.source;
			const installed = manager.getInstalledPath(source, scope);
			if (installed) {
				candidates.push(installed);
			}
		}
	}
	return candidates;
}

/** カンマ区切りと YAML 配列の別名を共通の表現にする。 */
function words(value: string | string[]) {
	return (typeof value === "string" ? value.split(",") : value)
		.map((word) => word.trim())
		.filter(Boolean);
}
