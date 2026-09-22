// 現在のproviderへ設定を委譲し、未登録providerではPi標準の推論設定を使う。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "../../../shared/piProviderControls";
import type { PiModelControls, PiProviders } from "./PiProvider";
import { piProviders } from "./PiProviders";
import type { PiCatalogSnapshot } from "./PiModelCatalog";

/** 固有機能の状態をセッションに閉じ込め、provider切替で破棄する。 */
export class PiProviderControls {
	private session: AgentSession | undefined;
	private provider: string | undefined;
	private active: PiModelControls | undefined;
	private catalog: (provider: string) => PiCatalogSnapshot = () => undefined;

	/** providerごとの最新metadataを設定処理・要求フックの両方で参照する。 */
	bindCatalog(read: (provider: string) => PiCatalogSnapshot): void {
		this.catalog = read;
	}

	constructor(private readonly providers: PiProviders = piProviders) {}

	/** SDKセッションを接続し、別セッションの固有設定を破棄する。 */
	bind(session: AgentSession): void {
		if (this.session !== session) {
			this.active?.reset();
			this.active = undefined;
			this.provider = undefined;
		}
		this.session = session;
	}

	/** Provider固有の実装は登録一覧から選び、非対応providerは標準経路へ戻す。 */
	private resolve(): PiModelControls | undefined {
		const provider = this.session?.model?.provider;
		if (provider !== this.provider) {
			this.active?.reset();
			this.provider = provider;
			this.active = provider
				? this.providers[provider]?.createControls?.()
				: undefined;
			if (this.session) {
				this.active?.bind(this.session);
			}
		}
		if (provider) {
			this.active?.setCatalog?.(this.catalog(provider));
		}
		return this.active;
	}

	/** 既存の共有状態形式を保ち、SDK標準モデルも同じUIへ公開する。 */
	snapshot(): ControlsState {
		const active = this.resolve();
		if (active) {
			return active.snapshot();
		}
		const thinkingLevel = this.session?.thinkingLevel ?? "off";
		return {
			provider: this.session?.model?.provider ?? null,
			modelId: this.session?.model?.id ?? null,
			thinkingLevel,
			effectiveReasoning: thinkingLevel,
			reasoningOverride: null,
			fastMode: false,
		};
	}

	/** 固有候補の意味を共通処理で判断しない。 */
	get reasoningOptions() {
		return (
			this.resolve()?.reasoningOptions ??
			this.session
				?.getAvailableThinkingLevels()
				.map((value) => ({ value, name: value })) ??
			[]
		);
	}

	/** Providerが定義した追加項目をそのままContributionへ渡す。 */
	get configOptions() {
		return this.resolve()?.configOptions ?? [];
	}

	/** 標準経路ではモデルmetadataに含まれる推論値だけを受け付ける。 */
	selectReasoning(value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		const active = this.resolve();
		if (active) {
			active.selectReasoning(value, signal);
			return;
		}
		const level = this.session
			?.getAvailableThinkingLevels()
			.find((item) => item === value);
		if (!level) {
			throw new Error("利用可能なPi推論レベルを選択してください。");
		}
		this.session!.setThinkingLevel(level);
	}

	/** 追加設定の受付はそのproviderに限定する。 */
	configure(id: string, value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		if (!this.resolve()?.configure(id, value, signal)) {
			throw new Error("未対応のPi設定です。");
		}
	}

	/** SDKの要求フックを選択中providerへ渡す。 */
	rewrite(payload: unknown, model: AgentSession["model"]): unknown {
		return this.resolve()?.rewrite(payload, model);
	}
}
