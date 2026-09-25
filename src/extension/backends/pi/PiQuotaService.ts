// プロバイダーの利用枠取得を共通の寿命管理へ接続し、取得失敗・古い応答を吸収する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { QuotaWindow } from "../../../shared/composer";
import type { PiProviders, PiQuotaReader } from "./PiProvider";
import { piProviders } from "./PiProviders";

/** 認証方式やエンドポイントはプロバイダー側のサービスが所有する。 */
export class PiQuotaService implements PiQuotaReader {
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private request: typeof fetch = fetch,
		private providers: PiProviders = piProviders,
	) {}

	/** プロバイダーをまたぐ保持は禁止し、モデル間の共有関係だけ登録先に委譲する。 */
	canRetainForModel(value: string): boolean {
		const current = this.session.model;
		if (!current || !value.startsWith(`${current.provider}/`)) {
			return false;
		}
		const nextId = value.slice(current.provider.length + 1);
		if (!nextId) {
			return false;
		}
		const group = this.providers[current.provider]?.quotaGroup;
		return group
			? group(current.id) === group(nextId)
			: current.id === nextId;
	}

	/** 対応サービスがないプロバイダーでは通信せず、利用枠なしを返す。 */
	async read(signal: AbortSignal): Promise<QuotaWindow[] | null> {
		try {
			signal.throwIfAborted();
			const model = this.session.model;
			const factory =
				model && this.providers[model.provider]?.createQuota;
			if (!model || !factory) {
				return null;
			}
			const quota = await factory(
				this.models,
				this.session,
				this.request,
			).read(signal);
			signal.throwIfAborted();
			return this.session.model?.provider === model.provider &&
				this.session.model?.id === model.id
				? quota
				: null;
		} catch {
			return null;
		}
	}
}
