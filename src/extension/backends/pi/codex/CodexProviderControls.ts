// Codex専用のUltra・Fast ModeとUI候補を保持し、Codex Responses要求へ適用する。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderControls as ControlsState } from "../../../../shared/piProviderControls";
import type { ConfigChoice, ConfigOption } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";
import type { PiModelControls } from "../PiProvider";

/** 組み込み拡張と設定UIが同じ実効値を参照する。 */
export class CodexProviderControls implements PiModelControls {
	private session?: AgentSession;
	private override: "ultra" | null = null;
	private fast = false;
	private modelKey = "";

	/** Provider切替後に固有設定を持ち越さない。 */
	reset(): void {
		this.override = null;
		this.fast = false;
	}

	/** Codex固有の推論候補だけを追加する。 */
	get reasoningOptions(): ConfigChoice[] {
		return this.supportsUltra ? [{ value: "ultra", name: "Ultra" }] : [];
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
			this.session.model.api === "openai-codex-responses"
		);
	}

	/** Ultraはmaxを持つCodexモデルに限定し、低い推論上限のモデルへ送らない。 */
	get supportsUltra(): boolean {
		return (
			this.supportsFastMode &&
			!!this.session?.getAvailableThinkingLevels().includes("max")
		);
	}

	/** SDKのモデル変更・clampを反映し、非対応のoverrideを破棄する。 */
	snapshot(): ControlsState {
		const session = this.session;
		const model = session?.model;
		const key = model ? `${model.provider}/${model.id}` : "";
		if (key !== this.modelKey) {
			this.modelKey = key;
			if (this.override && this.supportsUltra) {
				session!.setThinkingLevel("max");
			}
		}
		if (!this.supportsUltra || session?.thinkingLevel !== "max") {
			this.override = null;
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

	/** 通常値はSDKへ渡し、Ultraだけ有効な基底maxと別に保持する。 */
	selectReasoning(value: string, signal: AbortSignal): void {
		signal.throwIfAborted();
		this.snapshot();
		const session = this.session!;
		if (value === "ultra" && this.supportsUltra) {
			session.setThinkingLevel("max");
			this.override = "ultra";
			return;
		}
		const level = session
			.getAvailableThinkingLevels()
			.find((item) => item === value);
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
			!this.supportsFastMode ||
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
