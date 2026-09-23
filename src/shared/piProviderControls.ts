// Piの標準推論とNeritaの実効値を分け、秘密値を含まない設定状態だけを共有する。
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
export type PiThinkingLevel = (typeof piThinkingLevels)[number];

/** SDKのモデル・推論と、セッション内のprovider固有設定。 */
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
	return (
		isRecord(value) &&
		Object.keys(value).length === 6 &&
		isOptionalModelId(value.provider) &&
		isOptionalModelId(value.modelId) &&
		piThinkingLevels.some((level) => level === value.thinkingLevel) &&
		(value.reasoningOverride === null ||
			value.reasoningOverride === "ultra") &&
		value.effectiveReasoning ===
			(value.reasoningOverride ?? value.thinkingLevel) &&
		typeof value.fastMode === "boolean"
	);
}

/** 未選択を表すnullまたはモデル・providerの識別子を受け付ける。 */
function isOptionalModelId(value: unknown): boolean {
	return value === null || typeof value === "string";
}
