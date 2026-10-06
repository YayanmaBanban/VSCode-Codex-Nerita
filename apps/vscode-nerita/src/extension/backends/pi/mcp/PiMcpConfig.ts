// MCP 設定を上書き順に検証し、不正な上位設定から下位へ戻さない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type {
	McpServerConfig,
	RegisteredMcpServer,
} from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";

/** 接続に使う設定は秘密値を含むため、Host 内にだけ保持する。 */
export type PiMcpEntry = {
	name: string;
	scope: "global" | "project" | "extension";
	source: string;
	revision: string;
	config?: McpServerConfig;
	error?: string;
};

/** SDK の検証関数だけを差し替え、ファイル処理は Host が所有する。 */
export type PiMcpValidator = (
	name: string,
	value: unknown,
) => McpServerConfig | string;

/** 設定読み込みで必要な信頼状態と、明示的に信頼した拡張だけを受け取る。 */
export type PiMcpConfigOptions = {
	cwd: string;
	agentDir: string;
	projectTrusted: boolean;
	extensions?: RegisteredMcpServer[];
};

/** 設定全体が壊れている層は下位の接続を停止し、個別エラーは同名だけを停止する。 */
export async function loadPiMcpConfig(
	options: PiMcpConfigOptions,
	validate: PiMcpValidator,
): Promise<{ entries: PiMcpEntry[]; errors: string[] }> {
	const entries = new Map<string, PiMcpEntry>();
	const errors: string[] = [];
	for (const item of options.extensions ?? []) {
		entries.set(
			item.name,
			validatedEntry(
				item.name,
				item.config,
				"extension",
				item.extensionPath,
				digest(JSON.stringify(item.config)),
				validate,
			),
		);
	}
	for (const layer of configLayers(options)) {
		const loaded = await readLayer(layer, validate);
		if (isNonEmptyString(loaded.error)) {
			entries.clear();
			errors.push(loaded.error);
		}
		for (const entry of loaded.entries) {
			entries.set(entry.name, entry);
		}
	}
	if (entries.size > 32) {
		return {
			entries: [],
			errors: [...errors, "MCP サーバーは32件まで設定できます。"],
		};
	}
	return { entries: [...entries.values()], errors };
}

/** 未信頼ワークスペースの設定は読み込まず、グローバル設定だけを残す。 */
function configLayers(options: PiMcpConfigOptions) {
	return [
		{
			path: join(options.agentDir, "mcp.json"),
			scope: "global" as const,
			root: options.agentDir,
		},
		...(options.projectTrusted
			? [
					{
						path: join(options.cwd, ".pi/mcp.json"),
						scope: "project" as const,
						root: options.cwd,
					},
				]
			: []),
	];
}

/** 元の秘密値や例外をエラー表示へ載せず、読込み失敗の層を明示する。 */
async function readLayer(
	layer: ReturnType<typeof configLayers>[number],
	validate: PiMcpValidator,
): Promise<{ entries: PiMcpEntry[]; error?: string }> {
	try {
		const text = await configText(layer.path, layer.root);
		if (text === undefined) {
			return { entries: [] };
		}
		const value: unknown = JSON.parse(text);
		if (!isRecord(value) || !isRecord(value.mcpServers ?? {})) {
			throw new Error("invalid config");
		}
		const servers = value.mcpServers ?? {};
		const revision = digest(text);
		return {
			entries: Object.entries(servers).map(([name, config]) =>
				validatedEntry(
					name,
					config,
					layer.scope,
					layer.path,
					revision,
					validate,
				),
			),
		};
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") {
			return { entries: [] };
		}
		return {
			entries: [],
			error: `${layer.scope === "project" ? "ワークスペース" : "グローバル"}の MCP 設定を読み込めません。形式・サイズ・リンク先を確認してください。`,
		};
	}
}

/** シンボリックリンクと巨大な設定を拒否し、読み込むバイト数を先に制限する。 */
async function configText(
	path: string,
	root: string,
): Promise<string | undefined> {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) {
		throw new Error("invalid config file");
	}
	const target = await realpath(path);
	const base = await realpath(root);
	const within = relative(base, target);
	if (within.startsWith("..") || isAbsolute(within)) {
		throw new Error("config outside boundary");
	}
	const file = await open(path, "r");
	try {
		const bytes = Buffer.alloc(256 * 1024 + 1);
		const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
		if (bytesRead > 256 * 1024 || (await realpath(path)) !== target) {
			throw new Error("config changed");
		}
		return bytes.subarray(0, bytesRead).toString("utf8");
	} finally {
		await file.close();
	}
}

/** SDK の検証結果から安全な既定値を選び、コマンド補間を無効にする。 */
function validatedEntry(
	name: string,
	value: unknown,
	scope: PiMcpEntry["scope"],
	source: string,
	revision: string,
	validate: PiMcpValidator,
): PiMcpEntry {
	const base = {
		name,
		scope,
		source,
		revision: digest(`${scope}\0${name}\0${revision}`),
	};
	const result = validate(name, value);
	if (typeof result === "string" || hasCommandInterpolation(result)) {
		return {
			...base,
			error: "MCP の設定が不正か、未対応のコマンド補間を含んでいます。",
		};
	}
	const config = structuredClone(result);
	config.exposure ??= "deferred";
	// 設定からコピーした接続を、個別の有効化なしに起動しない。
	config.enabled = result.enabled === true;
	return { ...base, config };
}

/** SDK のシェルによるコマンド補間を、Host の承認外で実行させない。 */
function hasCommandInterpolation(config: McpServerConfig): boolean {
	const values =
		"url" in config
			? [
					...Object.values(config.headers ?? {}),
					config.oauth?.clientSecret ?? "",
				]
			: Object.values(config.env ?? {});
	return values.some((value) => value.trimStart().startsWith("!"));
}

/** 設定内容を公開せず、承認後に内容が変わっていないか確認できるハッシュ値にする。 */
function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
