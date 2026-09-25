// 固定 HTTPS 宛先から OAuth モデル一覧を取得し、同一アカウントの成功結果だけ再利用する。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel, PiModelCatalogReader } from "../PiModelCatalog";
import { codexOAuth } from "./CodexOAuth";
import { normalizeCodexModels } from "./CodexModelCatalog";

// モデル一覧の取得に使う client_version を固定する。
// この値は同梱 Codex CLI のバージョンとは別に管理する。
const MODEL_CATALOG_CLIENT_VERSION = "0.999.0";

/** HTTP 応答の本文・トークン・アカウント ID を返却値や例外へ含めない。 */
export class CodexModelCatalogService implements PiModelCatalogReader {
	private account: string | undefined;
	private cached: readonly PiCatalogModel[] | null = null;
	constructor(
		private models: ModelRuntime,
		private request: typeof fetch = fetch,
	) {}

	/** 認証更新を含め5秒で打ち切り、別アカウントのキャッシュは必ず破棄する。 */
	async read(caller: AbortSignal): Promise<readonly PiCatalogModel[] | null> {
		const signal = AbortSignal.any([caller, AbortSignal.timeout(5_000)]);
		let verified = false;
		try {
			const auth = await codexOAuth(this.models, signal);
			signal.throwIfAborted();
			this.updateAccount(auth);
			if (!auth) {
				return null;
			}
			verified = true;
			const response = await this.request(
				`https://chatgpt.com/backend-api/codex/models?client_version=${MODEL_CATALOG_CLIENT_VERSION}`,
				{
					signal,
					redirect: "error",
					headers: auth.headers,
				},
			);
			if (!response.ok) {
				await response.body?.cancel();
				return this.cached;
			}
			const payload = await readCatalogBody(response, signal);
			signal.throwIfAborted();
			const catalog = normalizeCodexModels(payload);
			if (catalog) {
				this.cached = catalog;
			}
			return this.cached;
		} catch {
			return !verified || caller.aborted ? null : this.cached;
		}
	}

	/** 認証先が変わった場合だけ古いモデル候補を破棄する。 */
	private updateAccount(
		auth: {
			account: string;
			headers: {
				Authorization: string;
				"ChatGPT-Account-Id": string;
				Accept: string;
			};
		} | null,
	) {
		if (this.account !== auth?.account) {
			this.account = auth?.account;
			this.cached = null;
		}
	}
}

/** `Content-Length` に依存せず、展開後の受信本文も上限内で読み取る。 */
async function readCatalogBody(
	response: Response,
	signal: AbortSignal,
): Promise<unknown> {
	const limit = 2 * 1024 * 1024;
	const reader = response.body?.getReader();
	if (!reader) {
		return null;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = (await reader.read()) as {
				done: boolean;
				value?: Uint8Array;
			};
			if (done) {
				break;
			}
			if (!value) {
				return null;
			}
			size += value.byteLength;
			if (size > limit) {
				return null;
			}
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
