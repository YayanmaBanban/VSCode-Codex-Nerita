// Pi の標準推論と Nerita の実効値を分け、秘密値を含まない設定状態だけを共有する。
import { isRecord } from "./validation";

export const piThinkingLevels = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
/** Pi の推論レベル。選択時には対象モデルが対応する候補であることも確認する。 */
export type PiThinkingLevel = (typeof piThinkingLevels)[number];

/** SDK のモデル・推論と、セッション内のプロバイダー固有設定。 */
export type PiProviderControls = {
	provider: string | null;
	modelId: string | null;
	thinkingLevel: PiThinkingLevel;
	reasoningOverride: "ultra" | null;
	effectiveReasoning: PiThinkingLevel | "ultra";
	fastMode: boolean;
};

/** 通信境界では未知のフィールドや実効値の不整合も拒否する。 */
export function isPiProviderControls(
	value: unknown,
): value is PiProviderControls {
	if (!isRecord(value)) {
		return false;
	}
	if (!(Object.keys(value).length === 6)) {
		return false;
	}
	if (!isOptionalModelId(value.provider)) {
		return false;
	}

	if (!isOptionalModelId(value.modelId)) {
		return false;
	}
	if (!piThinkingLevels.some((level) => level === value.thinkingLevel)) {
		return false;
	}
	const matchesReasoningOverride = !(
		value.reasoningOverride === null || value.reasoningOverride === "ultra"
	);
	if (matchesReasoningOverride) {
		return false;
	}
	return (
		value.effectiveReasoning ===
			(value.reasoningOverride ?? value.thinkingLevel) &&
		typeof value.fastMode === "boolean"
	);
}

/** 未選択を表す `null` またはモデル・プロバイダーの識別子を受け付ける。 */
function isOptionalModelId(value: unknown): boolean {
	return value === null || typeof value === "string";
}
