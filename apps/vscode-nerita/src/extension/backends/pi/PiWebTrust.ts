// pi-web-access の既定 UA を補い、取得先の信頼境界と実行前の設定の不変性を検査する。
import { fsErrorCode } from "../../runtime/FsError";
import { isRecord } from "@nerita/shared/validation";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { WorkspaceTrustStore } from "../../security/trust/WorkspaceTrustStore";
import { canonicalPath } from "../../security/WorkspacePathPolicy";

const webUserAgent = "Nerita/1.0";

/** シェルの Web コマンドにも、ユーザー指定または補完済みの UA を起動前に固定する。 */
export async function piWebUserAgent(): Promise<string> {
	const path = webConfigPath();
	await ensureWebConfig(path);
	const { userAgent } = await readWebConfig(path);
	if (!isNonEmptyString(userAgent) || !/^[\t\x20-\x7e]+$/.test(userAgent)) {
		throw new Error(
			"Web取得の User-Agent には空でない ASCII 文字列を設定してください。",
		);
	}
	return userAgent.trim();
}

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
		await ensureWebConfig(configPath);
		const initial = await readWebConfig(configPath);
		const cache = await canonicalPath(initial.cache, process.cwd());
		await store.registerExternalCache(cache);
		/** 設定先と内容・キャッシュの実体を照合し、接続後の設定変更を同じ承認で実行しない。 */
		const assertCurrentWebConfig = async () => {
			if (webConfigPath() !== configPath) {
				throw new Error(
					"Web取得の設定先が変更されました。再接続してください。",
				);
			}
			const current = await readWebConfig(configPath);
			if (!isNonEmptyString(current.userAgent)) {
				throw new Error(
					"Web取得の User-Agent が設定されていません。web-search.json の fetchContent.userAgent を設定して再接続してください。",
				);
			}
			const matchesDigest =
				current.digest !== initial.digest ||
				(await canonicalPath(current.cache, process.cwd())) !== cache;
			if (matchesDigest) {
				throw new Error(
					"Web取得の設定または保存先が変更されました。再接続してください。",
				);
			}
		};
		result.push({
			entry,
			cache,
			check: assertCurrentWebConfig,
		});
	}
	return result;
}

/** 未指定の UA だけを補い、ユーザーが指定した UA と他の設定項目を保持する。 */
async function ensureWebConfig(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	try {
		await writeFile(
			path,
			`${JSON.stringify({ fetchContent: { userAgent: webUserAgent } }, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		return;
	} catch (error) {
		if (fsErrorCode(error) !== "EEXIST") {
			throw error;
		}
	}
	const raw = await readFile(path, "utf8");
	const config: unknown = JSON.parse(raw);
	if (!isRecord(config)) {
		throw new Error("Web取得の設定形式が不正です。");
	}
	const fetchContent = config.fetchContent ?? {};
	if (!isRecord(fetchContent)) {
		throw new Error("Web取得の `fetchContent` の設定形式が不正です。");
	}
	const userAgent = fetchContent.userAgent;
	const blankString =
		typeof userAgent === "string" && userAgent.trim() === "";
	const missing =
		userAgent === undefined || userAgent === null || blankString;
	if (!missing) {
		return;
	}
	fetchContent.userAgent = webUserAgent;
	config.fetchContent = fetchContent;
	await appendWebUserAgent(path, raw, config);
}

/** 追記中の JSON や別の編集を上書きせず、リンクされた設定も元の実体へ保存する。 */
async function appendWebUserAgent(
	path: string,
	expected: string,
	config: Record<string, unknown>,
): Promise<void> {
	const target = await canonicalPath(path, process.cwd());
	const temporary = `${target}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	try {
		const current = await readFile(path, "utf8");
		if (current !== expected) {
			throw new Error(
				"Web取得の設定が変更されました。再接続してください。",
			);
		}
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
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

/** UA の設定値と、環境変数展開を含む clone 先・設定内容を実行前の照合に使う。 */
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
			: join(tmpdir(), "pi-github-repos");
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
		userAgent: isRecord(config.fetchContent)
			? config.fetchContent.userAgent
			: undefined,
		cache: resolve(expanded),
		digest: createHash("sha256").update(raw).update(expanded).digest("hex"),
	};
}
