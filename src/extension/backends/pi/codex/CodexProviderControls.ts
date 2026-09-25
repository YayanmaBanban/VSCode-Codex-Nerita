// Codex 専用の Ultra・Fast `Mode` と UI 候補を保持し、Codex Responses 要求へ適用する。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "../../../../shared/piProviderControls";
import type { ConfigChoice, ConfigOption } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";
import type { PiModelControls } from "../PiProvider";
import type { PiCatalogSnapshot } from "../PiModelCatalog";
import { CodexReasoningOverride } from "./CodexReasoningOverride";

/** 組み込み拡張と設定 UI が同じ実効値を参照する。 */
export class CodexProviderControls implements PiModelControls {
	private session?: AgentSession;
	private override: "ultra" | null = null;
	private fast = false;
	private modelKey = "";
	private catalog: PiCatalogSnapshot;
	private basis: AgentSession["thinkingLevel"] | undefined;
	private readonly reasoning = new CodexReasoningOverride();

	/** `null` はカタログで未確認の状態であり、Ultra・Fast の能力を推測しない。 */
	setCatalog(catalog: PiCatalogSnapshot): void {
		this.catalog = catalog;
	}

	/** 現在モデルのメタデータだけを要求制御に利用する。 */
	private get metadata() {
		return this.catalog?.find(
			(model) => model.slug === this.session?.model?.id,
		);
	}

	/** 取得したカタログで対応値が確認できたモデルは Pi 候補を絞り、未取得なら Pi へ委譲する。 */
	private get standardLevels() {
		const levels = this.session?.getAvailableThinkingLevels() ?? [];
		const metadata = this.metadata;
		return metadata
			? levels.filter((level) => metadata.reasoningLevels.includes(level))
			: levels;
	}

	/** Ultra の基底は `max`、live default、近い共通標準値の順で決める。 */
	private get ultraBasis() {
		const levels = this.standardLevels;
		const preferred = this.metadata?.defaultReasoning;
		return (
			levels.find((level) => level === "max") ??
			levels.find((level) => level === preferred) ??
			levels.at(-1)
		);
	}

	/** プロバイダー切替後に固有設定を持ち越さない。 */
	reset(): void {
		this.override = null;
		this.fast = false;
	}

	/** Pi 標準候補と取得したカタログが明示した Ultra を選択一覧へまとめる。 */
	get reasoningOptions(): ConfigChoice[] {
		return [
			...this.standardLevels.map((value) => ({ value, name: value })),
			...(this.supportsUltra ? [{ value: "ultra", name: "Ultra" }] : []),
		];
	}

	/** Fast `Mode` の UI 定義も Codex 側が所有する。 */
	get configOptions(): ConfigOption[] {
		const state = this.snapshot();
		return this.supportsFastMode
			? [
					{
						id: "fast-mode",
						name: "Fast mode",
						currentValue: state.fastMode ? "on" : "off",
						description:
							this.metadata?.serviceTiers.find(
								(tier) => tier.id === "priority",
							)?.description ??
							"優先処理を使用します。利用枠の消費が増える場合があります。",
						options: [
							{ value: "on", name: "On" },
							{ value: "off", name: "Off" },
						],
					},
				]
			: [];
	}

	/** 未登録の設定 ID は共通処理へ戻す。 */
	configure(id: string, value: string, signal: AbortSignal): boolean {
		if (id !== "fast-mode") {
			return false;
		}
		this.selectFastMode(value, signal);
		return true;
	}

	/** ResourceLoader 生成後に SDK セッションを接続する。 */
	bind(session: AgentSession): void {
		this.session = session;
	}

	/** Codex Responses を使うモデルだけが固有の要求形式を受け付ける。 */
	get supportsFastMode(): boolean {
		return (
			this.session?.model?.provider === "openai-codex" &&
			this.session.model.api === "openai-codex-responses" &&
			!!this.metadata?.serviceTiers.some((tier) => tier.id === "priority")
		);
	}

	/** Ultra は取得したカタログが明示し、安全な標準基底を適用できる場合だけ公開する。 */
	get supportsUltra(): boolean {
		return (
			this.session?.model?.api === "openai-codex-responses" &&
			!!this.metadata?.reasoningLevels.includes("ultra") &&
			!!this.ultraBasis
		);
	}

	/** SDK のモデル変更・範囲内への補正を反映し、非対応の `override` を破棄する。 */
	snapshot(): ControlsState {
		const session = this.session;
		const model = session?.model;
		const key = model ? `${model.provider}/${model.id}` : "";
		this.synchronizeUltraBasis(session, key);
		if (!this.supportsUltra || session?.thinkingLevel !== this.basis) {
			this.override = null;
		}
		if (!this.supportsFastMode) {
			this.fast = false;
		}
		return this.controlsState(session, model);
	}

	/** 標準値と固有の上書きを共有状態へ変換する。 */
	private controlsState(
		session: AgentSession | undefined,
		model: AgentSession["model"],
	): ControlsState {
		const thinkingLevel = session?.thinkingLevel ?? "off";
		return {
			provider: model?.provider ?? null,
			modelId: model?.id ?? null,
			thinkingLevel,
			reasoningOverride: this.override,
			effectiveReasoning: this.override ?? thinkingLevel,
			fastMode: this.fast,
		};
	}

	/** モデル切り替えと能力変更に合わせて Ultra の基底を更新する。 */
	private synchronizeUltraBasis(
		session: AgentSession | undefined,
		key: string,
	) {
		if (
			this.override &&
			this.supportsUltra &&
			this.basis &&
			!this.standardLevels.includes(this.basis)
		) {
			this.basis = this.ultraBasis;
			session!.setThinkingLevel(this.basis!);
		}
		if (key !== this.modelKey) {
			this.modelKey = key;
			if (this.override && this.supportsUltra) {
				this.basis = this.ultraBasis;
				session!.setThinkingLevel(this.basis!);
			}
		}
	}

	/** 通常値は SDK へ渡し、Ultra だけ有効な標準基底と別に保持する。 */
	selectReasoning(value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		this.snapshot();
		const session = this.session!;
		if (value === "ultra" && this.supportsUltra) {
			this.basis = this.ultraBasis;
			session.setThinkingLevel(this.basis!);
			this.override = "ultra";
			return;
		}
		const level = this.standardLevels.find((item) => item === value);
		if (!level) {
			throw new Error("利用可能なPi推論レベルを選択してください。");
		}
		session.setThinkingLevel(level);
		this.override = null;
	}

	/** Fast `Mode` は推論設定を変更しない。 */
	selectFastMode(value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		this.snapshot();
		if (!this.supportsFastMode || !["on", "off"].includes(value)) {
			throw new Error("このPiモデルではFast Modeを設定できません。");
		}
		this.fast = value === "on";
	}

	/** 他の拡張が追加したフィールドを保持し、指定された固有値だけ上書きする。 */
	rewrite(payload: unknown, model: AgentSession["model"]): unknown {
		const state = this.snapshot();
		if (
			!model ||
			!isRecord(payload) ||
			!this.matchesRequest(payload, model, state)
		) {
			return undefined;
		}
		const rewritten = this.rewriteReasoning(payload, model, state);
		return state.reasoningOverride || state.fastMode
			? overridePayload(isRecord(rewritten) ? rewritten : payload, state)
			: rewritten;
	}

	/** 圧縮用・フォールバック用要求を通常会話の履歴と混同しない。 */
	private matchesRequest(
		payload: Record<string, unknown>,
		model: NonNullable<AgentSession["model"]>,
		state: ControlsState,
	): boolean {
		return (
			!this.unsupportedResponsesModel() &&
			!this.session?.isCompacting &&
			model.provider === state.provider &&
			model.id === state.modelId &&
			model.api === "openai-codex-responses" &&
			(typeof payload.model !== "string" || payload.model === model.id)
		);
	}

	/** Ultra と通常推論の履歴管理を切り替える。 */
	private rewriteReasoning(
		payload: unknown,
		model: NonNullable<AgentSession["model"]>,
		state: ControlsState,
	): unknown {
		const store = this.session?.sessionManager;
		if (store) {
			if (
				this.supportsReasoningUpdates(model) &&
				!state.reasoningOverride
			) {
				return this.reasoning.rewrite(
					payload,
					`${model.provider}/${model.id}/${model.baseUrl}`,
					store,
				);
			} else {
				this.reasoning.clear(store);
			}
		}
		return undefined;
	}

	/** カタログで確認した能力は取得元の Codex エンドポイントだけに適用し、独自エンドポイントの能力は推測しない。 */
	private supportsReasoningUpdates(model: AgentSession["model"]): boolean {
		if (
			model?.provider !== "openai-codex" ||
			model.api !== "openai-codex-responses" ||
			this.metadata?.supportsReasoningEffortUpdates !== true
		) {
			return false;
		}
		return isCatalogEndpoint(model.baseUrl);
	}

	/** 現在のモデルが Codex 固有の要求形式に対応するか照合する。 */
	private unsupportedResponsesModel() {
		return this.session?.model?.api !== "openai-codex-responses";
	}
}

/** `capability` 取得先と異なるエンドポイントでは有効化しない。 */
function isCatalogEndpoint(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return (
			url.origin === "https://chatgpt.com" &&
			[
				"/backend-api",
				"/backend-api/codex",
				"/backend-api/codex/responses",
			].includes(url.pathname.replace(/\/$/, "")) &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

/** 既存の要求フィールドを保持して Ultra と Fast を適用する。 */
function overridePayload(
	payload: Record<string, unknown>,
	state: ControlsState,
): unknown {
	return {
		...payload,
		...(state.reasoningOverride
			? {
					reasoning: {
						...(isRecord(payload.reasoning)
							? payload.reasoning
							: {}),
						effort: "ultra",
					},
				}
			: {}),
		...(state.fastMode ? { service_tier: "priority" } : {}),
	};
}
