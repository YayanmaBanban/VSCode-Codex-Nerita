// Codex専用のUltra・Fast ModeとUI候補を保持し、Codex Responses要求へ適用する。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "../../../../shared/piProviderControls";
import type { ConfigChoice, ConfigOption } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";
import type { PiModelControls } from "../PiProvider";
import type { PiCatalogSnapshot } from "../PiModelCatalog";

/** 組み込み拡張と設定UIが同じ実効値を参照する。 */
export class CodexProviderControls implements PiModelControls {
	private session?: AgentSession;
	private override: "ultra" | null = null;
	private fast = false;
	private modelKey = "";
	private catalog: PiCatalogSnapshot;
	private basis: AgentSession["thinkingLevel"] | undefined;

	/** nullはlive未確認であり、Ultra・Fastの能力を推測しない。 */
	setCatalog(catalog: PiCatalogSnapshot): void {
		this.catalog = catalog;
	}

	/** 現在モデルのmetadataだけを要求制御に利用する。 */
	private get metadata() {
		return this.catalog?.find(
			(model) => model.slug === this.session?.model?.id,
		);
	}

	/** 標準値はLive ∩ Pi。live未確認では現状を保ちつつ選択は許可しない。 */
	private get standardLevels() {
		const levels = this.session?.getAvailableThinkingLevels() ?? [];
		return this.catalog === undefined
			? levels
			: levels.filter((level) =>
					this.metadata?.reasoningLevels.includes(level),
				);
	}

	/** Ultraの基底はmax、live default、近い共通標準値の順で決める。 */
	private get ultraBasis() {
		const levels = this.standardLevels;
		const preferred = this.metadata?.defaultReasoning;
		return (
			levels.find((level) => level === "max") ??
			levels.find((level) => level === preferred) ??
			levels.at(-1)
		);
	}

	/** Provider切替後に固有設定を持ち越さない。 */
	reset(): void {
		this.override = null;
		this.fast = false;
	}

	/** 標準intersectionとlive Ultraを一つの選択一覧へまとめる。 */
	get reasoningOptions(): ConfigChoice[] {
		return [
			...this.standardLevels.map((value) => ({ value, name: value })),
			...(this.supportsUltra ? [{ value: "ultra", name: "Ultra" }] : []),
		];
	}

	/** Fast ModeのUI定義もCodex側が所有する。 */
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

	/** 未登録の設定IDは共通処理へ戻す。 */
	configure(id: string, value: string, signal: AbortSignal): boolean {
		if (id !== "fast-mode") {
			return false;
		}
		this.selectFastMode(value, signal);
		return true;
	}

	/** ResourceLoader生成後にSDKセッションを接続する。 */
	bind(session: AgentSession): void {
		this.session = session;
	}

	/** Codex Responsesを使うモデルだけが固有の要求形式を受け付ける。 */
	get supportsFastMode(): boolean {
		return (
			this.session?.model?.provider === "openai-codex" &&
			this.session.model.api === "openai-codex-responses" &&
			!!this.metadata?.serviceTiers.some((tier) => tier.id === "priority")
		);
	}

	/** Ultraはliveが明示し、安全な標準基底を適用できる場合だけ公開する。 */
	get supportsUltra(): boolean {
		return (
			this.session?.model?.api === "openai-codex-responses" &&
			!!this.metadata?.reasoningLevels.includes("ultra") &&
			!!this.ultraBasis
		);
	}

	/** SDKのモデル変更・clampを反映し、非対応のoverrideを破棄する。 */
	snapshot(): ControlsState {
		const session = this.session;
		const model = session?.model;
		const key = model ? `${model.provider}/${model.id}` : "";
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
		if (!this.supportsUltra || session?.thinkingLevel !== this.basis) {
			this.override = null;
		}
		const levels = this.standardLevels;
		if (
			session &&
			this.metadata &&
			!levels.includes(session.thinkingLevel)
		) {
			if (
				this.metadata.defaultReasoning === "ultra" &&
				this.supportsUltra
			) {
				this.basis = this.ultraBasis;
				session.setThinkingLevel(this.basis!);
				this.override = "ultra";
			} else {
				const fallback =
					levels.find(
						(level) => level === this.metadata?.defaultReasoning,
					) ??
					levels.find((level) => level === "medium") ??
					levels.at(-1);
				if (fallback) {
					session.setThinkingLevel(fallback);
				}
			}
		}
		if (!this.supportsFastMode) {
			this.fast = false;
		}
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

	/** 通常値はSDKへ渡し、Ultraだけ有効な標準基底と別に保持する。 */
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

	/** Fast Modeは推論設定を変更しない。 */
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
			this.session?.model?.api !== "openai-codex-responses" ||
			model?.provider !== state.provider ||
			model?.id !== state.modelId ||
			!isRecord(payload) ||
			(!state.reasoningOverride && !state.fastMode)
		) {
			return undefined;
		}
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
}
