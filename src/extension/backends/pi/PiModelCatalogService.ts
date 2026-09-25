// プロバイダー登録から補助メタデータ取得へ委譲し、取消・世代と表示情報を管理する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { PiCatalogSnapshot, PiModelCatalogReader } from "./PiModelCatalog";
import type { PiProviders } from "./PiProvider";
import { piProviders } from "./PiProviders";

/** Session 内だけに保持し、認証操作で `reader` のアカウント キャッシュごと破棄する。 */
export class PiModelCatalogService {
	private readers = new Map<string, PiModelCatalogReader>();
	private catalogs = new Map<string, PiCatalogSnapshot>();
	private abort: AbortController | undefined;
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private request: typeof fetch = fetch,
		private providers: PiProviders = piProviders,
	) {}

	/** メタデータ取得元のあるプロバイダーでは、未取得を `null` で示す。 */
	snapshot(provider: string): PiCatalogSnapshot {
		return this.providers[provider]?.createCatalog
			? (this.catalogs.get(provider) ?? null)
			: undefined;
	}

	/** 認証変更は同じプロバイダーでも別アカウントとして扱う。 */
	invalidate(): void {
		this.abort?.abort();
		this.readers.clear();
		this.catalogs.clear();
	}

	/** プロバイダー変更の途中でも取得でき、開始時の `session` が変わった結果は捨てる。 */
	async refresh(provider: string, caller: AbortSignal): Promise<void> {
		this.abort?.abort();
		const abort = new AbortController();
		this.abort = abort;
		const signal = AbortSignal.any([caller, abort.signal]);
		const model = this.session.model;
		if (this.snapshot(provider) === undefined) {
			return;
		}
		let reader = this.readers.get(provider);
		if (!reader) {
			reader = this.providers[provider]?.createCatalog?.(
				this.models,
				this.request,
			);
			if (!reader) {
				return;
			}
			this.readers.set(provider, reader);
		}
		try {
			const catalog = await reader.read(signal);
			if (!signal.aborted && this.session.model === model) {
				this.catalogs.set(provider, catalog);
			}
		} catch {
			/* 認証値を含みうる例外は公開しない。 */
		}
	}

	/** カタログの取得成功時は公開候補に絞り、未取得なら Pi の候補を維持する。 */
	available(available = this.models.getAvailableSnapshot()) {
		const result = available.filter((model) => {
			const catalog = this.snapshot(model.provider);
			return (
				catalog === null ||
				catalog === undefined ||
				catalog.some(
					(item) =>
						item.slug === model.id && item.visibility === "list",
				)
			);
		});
		const indexes = new Map<string, number[]>();
		for (const [index, model] of result.entries()) {
			if (this.metadata(model.provider, model.id)) {
				indexes.set(model.provider, [
					...(indexes.get(model.provider) ?? []),
					index,
				]);
			}
		}
		for (const positions of indexes.values()) {
			const sorted = positions
				.map((index) => result[index]!)
				.sort(
					(a, b) =>
						this.metadata(a.provider, a.id)!.priority -
						this.metadata(b.provider, b.id)!.priority,
				);
			positions.forEach((index, offset) => {
				result[index] = sorted[offset]!;
			});
		}
		return result;
	}

	/** 取得したカタログの `visibility` に関わらず、同じ `slug` の補助メタデータを返す。 */
	metadata(provider: string, modelId: string) {
		return this.snapshot(provider)?.find((item) => item.slug === modelId);
	}
}
