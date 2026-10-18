// ChatGPT OAuth の公開 API から表示候補を取得し、認証変更時はキャッシュを破棄する。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel, PiModelCatalogReader } from "../PiModelCatalog";
import { openAIOAuth } from "./OpenAIOAuth";
import { normalizeOpenAIModels } from "./OpenAIModelCatalog";
import { readOpenAIResponse } from "./OpenAIResponseBody";
import {
	PiAuthFailure,
	piAuthFailure,
	piAuthResponseFailure,
} from "../PiAuthFailure";

// 未指定では新モデルが省略されるため、モデル一覧用のクライアント版を明示する。
// 同梱 CLI の実行バージョンとは独立した、検証済みのカタログ要求値。
const MODEL_CATALOG_CLIENT_VERSION = "0.999.0";

/** 通常推論は SDK が担当し、ライブ一覧と Ultra の能力を補う。 */
export class OpenAIModelCatalogService implements PiModelCatalogReader {
	private credentialKey: string | undefined;
	private cached: readonly PiCatalogModel[] | null = null;
	failure: PiAuthFailure | undefined;
	/** 接続時の認証でモデル一覧を取得する。検証時は通信経路を差し替えられる。 */
	constructor(
		private models: ModelRuntime,
		private request: typeof fetch = fetch,
	) {}

	/** 同じ認証の成功結果だけ再利用し、応答本文や認証値を公開しない。 */
	async read(caller: AbortSignal): Promise<readonly PiCatalogModel[] | null> {
		this.failure = undefined;
		const signal = AbortSignal.any([caller, AbortSignal.timeout(5_000)]);
		let verified = false;
		try {
			const auth = await openAIOAuth(this.models, signal);
			this.updateCredential(auth?.key);
			if (!auth) {
				return this.missingOAuth();
			}
			verified = true;
			const response = await this.request(
				`https://api.openai.com/v1/models?client_version=${MODEL_CATALOG_CLIENT_VERSION}`,
				{ signal, redirect: "error", headers: auth.headers },
			);
			if (!response.ok) {
				return await this.denied(response, signal);
			}
			const catalog = normalizeOpenAIModels(
				await readOpenAIResponse(response, signal),
			);
			signal.throwIfAborted();
			if (catalog) {
				this.cached = catalog;
			} else {
				this.failure = new PiAuthFailure("unavailable");
			}
			return this.cached;
		} catch (error) {
			return this.failed(error, signal, caller, verified);
		}
	}

	/** API キー使用時は OAuth の確認を省き、OAuth の解決失敗だけを再ログイン対象にする。 */
	private missingOAuth() {
		if (this.models.isUsingOAuth("openai")) {
			this.failure = new PiAuthFailure("reauthenticate");
		}
		return null;
	}

	/** 認証・権限の拒否が明らかな場合は、古い成功結果を選択可能な状態で残さない。 */
	private async denied(response: Response, signal: AbortSignal) {
		this.failure = await deniedCatalog(response, signal);
		if (response.status === 401 || response.status === 403) {
			this.cached = null;
		}
		return this.cached;
	}

	/** 一時的な通信失敗では検証済み候補を保持し、認証解決前の失敗や取消しでは利用しない。 */
	private failed(
		error: unknown,
		signal: AbortSignal,
		caller: AbortSignal,
		verified: boolean,
	) {
		this.failure =
			signal.aborted && !caller.aborted
				? new PiAuthFailure("network")
				: piAuthFailure(error);
		if (!verified) {
			this.cached = null;
		}
		return caller.aborted ? null : this.cached;
	}

	/** トークンが変わったら以前のアカウントの結果を返さない。 */
	private updateCredential(key: string | undefined): void {
		if (this.credentialKey !== key) {
			this.credentialKey = key;
			this.cached = null;
		}
	}
}

/** 本文を制限して既知の拒否コードだけを分類し、読取り失敗でも HTTP 拒否を保持する。 */
async function deniedCatalog(response: Response, signal: AbortSignal) {
	let payload: unknown;
	try {
		payload = await readOpenAIResponse(response, signal);
	} catch {
		payload = undefined;
	}
	return piAuthResponseFailure(response.status, payload);
}
