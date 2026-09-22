// Provider登録からlive catalogへ委譲し、取消・世代とHost側モデル候補を一元管理する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { PiCatalogSnapshot, PiModelCatalogReader } from "./PiModelCatalog";
import type { PiProviders } from "./PiProvider";
import { piProviders } from "./PiProviders";

/** Session内だけに保持し、認証操作でreaderのaccount cacheごと破棄する。 */
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

	/** 未取得のOAuth catalogはnullで示し、static候補へ展開しない。 */
	snapshot(provider: string): PiCatalogSnapshot {
		return this.providers[provider]?.usesCatalog?.(this.models)
			? (this.catalogs.get(provider) ?? null)
			: undefined;
	}

	/** 認証変更は同じproviderでも別accountとして扱う。 */
	invalidate(): void {
		this.abort?.abort();
		this.readers.clear();
		this.catalogs.clear();
	}

	/** provider変更の途中でも取得でき、開始時のsessionが変わった結果は捨てる。 */
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

	/** picker候補はlive ∩ Pi。未取得時は現在モデル以外を追加しない。 */
	available(available = this.models.getAvailableSnapshot()) {
		const providers = [
			...new Set(available.map((model) => model.provider)),
		];
		return available
			.filter((model) => {
				const catalog = this.snapshot(model.provider);
				if (catalog === undefined) {
					return true;
				}
				if (catalog === null) {
					return (
						model.provider === this.session.model?.provider &&
						model.id === this.session.model.id
					);
				}
				return catalog.some(
					(item) =>
						item.slug === model.id && item.visibility === "list",
				);
			})
			.sort((a, b) => {
				if (a.provider !== b.provider) {
					return (
						providers.indexOf(a.provider) -
						providers.indexOf(b.provider)
					);
				}
				const catalog = this.snapshot(a.provider);
				return (
					(catalog?.find((item) => item.slug === a.id)?.priority ??
						0) -
					(catalog?.find((item) => item.slug === b.id)?.priority ?? 0)
				);
			});
	}

	/** hidden化だけでは履歴モデルを変更せず、存在しない場合だけ復帰を試みる。 */
	canRetain(model: NonNullable<AgentSession["model"]>): boolean {
		const catalog = this.snapshot(model.provider);
		return (
			catalog === null ||
			catalog === undefined ||
			catalog.some((item) => item.slug === model.id)
		);
	}
}
