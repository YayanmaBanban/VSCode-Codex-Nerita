// ChatGPT OAuth の公開 API から表示候補を取得し、認証変更時はキャッシュを破棄する。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel, PiModelCatalogReader } from "../PiModelCatalog";
import { openAIOAuth } from "./OpenAIOAuth";
import { normalizeOpenAIModels } from "./OpenAIModelCatalog";
import { readOpenAIResponse } from "./OpenAIResponseBody";

// 未指定では新モデルが省略されるため、モデル一覧用のクライアント版を明示する。
// 同梱 CLI の実行バージョンとは独立した、検証済みのカタログ要求値。
const MODEL_CATALOG_CLIENT_VERSION = "0.999.0";

/** 通常推論は SDK が担当し、ライブ一覧と Ultra の能力を補う。 */
export class OpenAIModelCatalogService implements PiModelCatalogReader {
	private credentialKey: string | undefined;
	private cached: readonly PiCatalogModel[] | null = null;
	constructor(
		private models: ModelRuntime,
		private request: typeof fetch = fetch,
	) {}

	/** 同じ認証の成功結果だけ再利用し、応答本文や認証値を公開しない。 */
	async read(caller: AbortSignal): Promise<readonly PiCatalogModel[] | null> {
		const signal = AbortSignal.any([caller, AbortSignal.timeout(5_000)]);
		let verified = false;
		try {
			const auth = await openAIOAuth(this.models, signal);
			this.updateCredential(auth?.key);
			if (!auth) {
				return null;
			}
			verified = true;
			const response = await this.request(
				`https://api.openai.com/v1/models?client_version=${MODEL_CATALOG_CLIENT_VERSION}`,
				{ signal, redirect: "error", headers: auth.headers },
			);
			if (!response.ok) {
				await response.body?.cancel();
				return this.cached;
			}
			const catalog = normalizeOpenAIModels(
				await readOpenAIResponse(response, signal),
			);
			signal.throwIfAborted();
			if (catalog) {
				this.cached = catalog;
			}
			return this.cached;
		} catch {
			return !verified || caller.aborted ? null : this.cached;
		}
	}

	/** トークンが変わったら以前のアカウントの結果を返さない。 */
	private updateCredential(key: string | undefined): void {
		if (this.credentialKey !== key) {
			this.credentialKey = key;
			this.cached = null;
		}
	}
}
