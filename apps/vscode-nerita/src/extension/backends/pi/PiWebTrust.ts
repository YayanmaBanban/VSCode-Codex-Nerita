// pi-web-access の取得先をロード前に登録し、通知がなくても新規 clone を未信頼にする。
import { fsErrorCode } from "../../runtime/FsError";
import { isRecord } from "@nerita/shared/validation";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { WorkspaceTrustStore } from "../../security/trust/WorkspaceTrustStore";
import { canonicalPath } from "../../security/WorkspacePathPolicy";

/** 検証した設定と取得先を実行直前まで固定する。 */
export type PiWebTrust = {
	entry: string;
	cache: string;
	check: () => Promise<void>;
};

/** 導入済み単一 entry の所属パッケージだけを識別し、ツール名では識別しない。 */
export async function preparePiWebTrust(
	entries: string[],
	store: WorkspaceTrustStore,
): Promise<PiWebTrust[]> {
	const result: PiWebTrust[] = [];
	for (const entry of entries) {
		let manifest: unknown;
		try {
			manifest = JSON.parse(
				await readFile(join(dirname(entry), "../package.json"), "utf8"),
			);
		} catch {
			continue;
		}
		if (!isRecord(manifest) || manifest.name !== "pi-web-access") {
			continue;
		}
		const configPath = webConfigPath();
		const initial = await readWebConfig(configPath);
		const cache = await canonicalPath(initial.cache, process.cwd());
		await store.registerExternalCache(cache);
		result.push({
			entry,
			cache,
			check: async () => {
				if (webConfigPath() !== configPath) {
					throw new Error(
						"Web取得の設定先が変更されました。再接続してください。",
					);
				}
				const current = await readWebConfig(configPath);
				if (
					current.digest !== initial.digest ||
					(await canonicalPath(current.cache, process.cwd())) !==
						cache
				) {
					throw new Error(
						"Web取得の設定または保存先が変更されました。再接続してください。",
					);
				}
			},
		});
	}
	return result;
}

/** Web 拡張の設定探索順に従って設定ファイルを選ぶ。 */
function webConfigPath(): string {
	if (isNonEmptyString(process.env.PI_CODING_AGENT_DIR)) {
		return join(process.env.PI_CODING_AGENT_DIR, "web-search.json");
	}
	const primary = isNonEmptyString(process.env.XDG_CONFIG_HOME)
		? join(process.env.XDG_CONFIG_HOME, "pi")
		: join(homedir(), ".pi/agent");
	const legacy = join(homedir(), ".pi");
	if (existsSync(join(primary, "web-search.json"))) {
		return join(primary, "web-search.json");
	}
	return join(
		existsSync(join(legacy, "web-search.json")) ? legacy : primary,
		"web-search.json",
	);
}

/** 設定を再読込みし、環境変数展開を含めて clone 先を固定する。 */
async function readWebConfig(path: string) {
	let raw = "{}";
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (fsErrorCode(error) !== "ENOENT") {
			throw error;
		}
	}
	const config: unknown = JSON.parse(raw);
	if (!isRecord(config)) {
		throw new Error("Web取得の設定形式が不正です。");
	}
	const configured = isRecord(config.githubClone)
		? config.githubClone.clonePath
		: undefined;
	const cache =
		typeof configured === "string" && configured.trim() !== ""
			? configured.trim()
			: "/tmp/pi-github-repos";
	const expanded = cache
		.replace(
			/^~(?=\/|$)/,
			process.env.HOME ?? process.env.USERPROFILE ?? "",
		)
		.replace(
			/\$([A-Z_]\w*)/gi,
			(match, name: string) => process.env[name] ?? match,
		);
	return {
		cache: resolve(expanded),
		digest: createHash("sha256").update(raw).update(expanded).digest("hex"),
	};
}
