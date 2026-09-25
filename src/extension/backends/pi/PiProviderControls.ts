// 現在のプロバイダーへ設定を委譲し、未登録プロバイダーでは Pi 標準の推論設定を使う。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "../../../shared/piProviderControls";
import type { PiModelControls, PiProviders } from "./PiProvider";
import { piProviders } from "./PiProviders";
import type { PiCatalogSnapshot } from "./PiModelCatalog";

/** 固有機能の状態をセッションに閉じ込め、プロバイダー切替で破棄する。 */
export class PiProviderControls {
	private session: AgentSession | undefined;
	private provider: string | undefined;
	private active: PiModelControls | undefined;
	private catalog: (provider: string) => PiCatalogSnapshot = () => undefined;

	/** プロバイダーごとの最新メタデータを設定処理・要求フックの両方で参照する。 */
	bindCatalog(read: (provider: string) => PiCatalogSnapshot): void {
		this.catalog = read;
	}

	constructor(private readonly providers: PiProviders = piProviders) {}

	/** SDK セッションを接続し、別セッションの固有設定を破棄する。 */
	bind(session: AgentSession): void {
		if (this.session !== session) {
			this.active?.reset();
			this.active = undefined;
			this.provider = undefined;
		}
		this.session = session;
	}

	/** プロバイダー固有の実装は登録一覧から選び、非対応プロバイダーは標準経路へ戻す。 */
	private resolve(): PiModelControls | undefined {
		const provider = this.session?.model?.provider;
		this.bindProviderControls(provider);
		if (provider) {
			this.active?.setCatalog?.(this.catalog(provider));
		}
		return this.active;
	}

	/** プロバイダー切り替え時に固有設定を作り直す。 */
	private bindProviderControls(provider: string | undefined): void {
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
	}

	/** 既存の共有状態形式を保ち、SDK 標準モデルも同じ UI へ公開する。 */
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

	/** プロバイダーが定義した追加項目をそのまま Contribution へ渡す。 */
	get configOptions() {
		return this.resolve()?.configOptions ?? [];
	}

	/** 標準経路ではモデルメタデータに含まれる推論値だけを受け付ける。 */
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

	/** 追加設定の受付はそのプロバイダーに限定する。 */
	configure(id: string, value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		if (!this.resolve()?.configure(id, value, signal)) {
			throw new Error("未対応のPi設定です。");
		}
	}

	/** SDK の要求フックを選択中プロバイダーへ渡す。 */
	rewrite(payload: unknown, model: AgentSession["model"]): unknown {
		return this.resolve()?.rewrite(payload, model);
	}
}
