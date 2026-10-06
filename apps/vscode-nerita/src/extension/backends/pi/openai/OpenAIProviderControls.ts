// Ultra は Host の委譲方針として保持し、通常推論とサービス要求の値を分ける。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "@nerita/shared/piProviderControls";
import type { ConfigChoice, ConfigOption } from "@nerita/shared/composer";
import type { PiModelControls } from "../PiProvider";
import type { PiCatalogSnapshot } from "../PiModelCatalog";
import { isOpenAIEndpoint } from "./OpenAIOAuth";
import { isRecord } from "@nerita/shared/validation";

/** ライブカタログの能力を設定へ反映し、Ultra の委譲と Fast の優先処理要求を管理する。 */
export class OpenAIProviderControls implements PiModelControls {
	private session?: AgentSession;
	private ultra = false;
	private ultraBasis?: AgentSession["thinkingLevel"];
	private fast = false;
	private key = "";
	private canDelegate = () => false;
	private catalog: PiCatalogSnapshot = null;

	/** 認証に対応する最新のカタログだけから Ultra の能力を確認する。 */
	setCatalog(catalog: PiCatalogSnapshot): void {
		this.catalog = catalog;
	}

	/** セッション内の子定義・有効ツール・認証を毎回確認する。 */
	bindDelegation(read: () => boolean): void {
		this.canDelegate = read;
	}
	/** SDK セッションだけを参照し、旧補助カタログの推論値を使わない。 */
	bind(session: AgentSession): void {
		this.session = session;
	}
	/** プロバイダー切替で委譲設定を破棄する。 */
	reset(): void {
		this.ultra = false;
		this.fast = false;
	}
	/** 能力を取得した OpenAI の公開 API を使うモデルだけを扱う。 */
	private get openAIModel() {
		const model = this.session?.model;
		if (
			model?.provider !== "openai" ||
			model.api !== "openai-responses" ||
			!isOpenAIEndpoint(model.baseUrl)
		) {
			return undefined;
		}
		return model;
	}
	/** 選択したモデルの公開能力だけを参照する。 */
	private get metadata() {
		const model = this.openAIModel;
		return model
			? this.catalog?.find(
					(item) =>
						item.slug === model.id && item.visibility === "list",
				)
			: undefined;
	}
	/** ライブカタログが解決した実推論値を送信できる SDK レベルだけを選ぶ。 */
	private get ultraLevel() {
		const model = this.openAIModel;
		if (!model || !this.canDelegate()) {
			return undefined;
		}
		const effort = this.metadata?.ultraEffort;
		return effort !== undefined
			? this.session
					?.getAvailableThinkingLevels()
					.find((level) => model.thinkingLevelMap?.[level] === effort)
			: undefined;
	}
	/** 通常の候補は SDK から取得し、Host の委譲設定だけ追加する。 */
	get reasoningOptions(): ConfigChoice[] {
		this.snapshot();
		return [
			...(this.session?.getAvailableThinkingLevels() ?? []).map(
				(value) => ({ value, name: value }),
			),
			...(this.ultraLevel !== undefined
				? [{ value: "ultra", name: "Ultra" }]
				: []),
		];
	}
	/** Fast は優先処理を要求する設定として公開し、処理速度そのものを保証しない。 */
	get configOptions(): ConfigOption[] {
		const state = this.snapshot();
		return this.metadata?.fastMode === true
			? [
					{
						id: "fast-mode",
						name: "Fast mode",
						currentValue: state.fastMode ? "on" : "off",
						description:
							"優先処理を要求します。利用枠の消費が増える場合があります。",
						options: [
							{ value: "on", name: "On" },
							{ value: "off", name: "Off" },
						],
					},
				]
			: [];
	}
	/** 対応が確認できるモデルだけで Fast を変更する。 */
	configure(id: string, value: string, signal: AbortSignal): boolean {
		signal.throwIfAborted();
		this.snapshot();
		if (
			id !== "fast-mode" ||
			!(this.metadata?.fastMode === true) ||
			!["on", "off"].includes(value)
		) {
			return false;
		}
		this.fast = value === "on";
		return true;
	}
	/** モデル・権限・ツールが変わったら Ultra を解除する。 */
	snapshot(): ControlsState {
		this.synchronize();
		const { provider, id } = this.session?.model ?? {
			provider: null,
			id: null,
		};
		const thinkingLevel = this.session?.thinkingLevel ?? "off";
		const override = this.ultra ? "ultra" : null;
		return {
			provider,
			modelId: id,
			thinkingLevel,
			reasoningOverride: override,
			effectiveReasoning: override ?? thinkingLevel,
			fastMode: this.fast,
		};
	}

	/** モデルや子起動の失効を状態の公開前に反映する。 */
	private synchronize(): void {
		const model = this.session?.model;
		const level = this.ultraLevel;
		const key = model
			? `${model.provider}/${model.id}/${model.api}/${model.baseUrl}`
			: "";
		if (key !== this.key) {
			this.reset();
		}
		if (
			!(level !== undefined) ||
			level !== this.ultraBasis ||
			this.session?.thinkingLevel !== level
		) {
			this.ultra = false;
		}
		if (!(this.metadata?.fastMode === true)) {
			this.fast = false;
		}
		this.key = key;
	}
	/** Ultra の実推論値はライブカタログから解決し、SDK には対応する通常レベルを指定する。 */
	selectReasoning(value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		this.snapshot();
		const ultraLevel = this.ultraLevel;
		if (value === "ultra" && ultraLevel !== undefined) {
			this.session!.setThinkingLevel(ultraLevel);
			this.ultraBasis = ultraLevel;
			this.ultra = true;
			return;
		}
		const level = this.session
			?.getAvailableThinkingLevels()
			.find((item) => item === value);
		if (!(level !== undefined)) {
			throw new Error("利用可能な Pi 推論レベルを選択してください。");
		}
		this.session!.setThinkingLevel(level);
		this.ultra = false;
	}
	/** Fast は Codex CLI と同じ priority を送り、Ultra の実推論値は SDK に任せる。 */
	rewrite(payload: unknown, model: AgentSession["model"]): unknown {
		const state = this.snapshot();
		if (
			!state.fastMode ||
			!isRecord(payload) ||
			!this.matchesRequest(payload, model)
		) {
			return undefined;
		}
		return { ...payload, service_tier: "priority" };
	}
	/** 別モデル・独自宛先・圧縮用の要求へ会話の Fast 設定を流用しない。 */
	private matchesRequest(
		payload: Record<string, unknown>,
		model: AgentSession["model"],
	): boolean {
		const current = this.openAIModel;
		return (
			!!current &&
			!!model &&
			!(this.session?.isCompacting === true) &&
			model.provider === current.provider &&
			model.id === current.id &&
			model.api === current.api &&
			model.baseUrl === current.baseUrl &&
			(typeof payload.model !== "string" || payload.model === model.id)
		);
	}
	/** 承認と停止を管理する Host ツールをモデルの委譲先として案内する。 */
	delegationPrompt(): string | undefined {
		return this.snapshot().reasoningOverride === "ultra"
			? "Ultra mode is enabled. You may proactively delegate independent work to the available subagents through the subagent tool. Keep the parent responsible for integration. Use subagent_job to collect or stop background work. All delegation must use these Host tools and follow their approval and permission restrictions."
			: undefined;
	}
}
