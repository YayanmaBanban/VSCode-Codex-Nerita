// Codex の選択だけを永続化し、起動時は現在のモデル候補で検証する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { isRecord } from "@nerita/shared/validation";
import type { ModelInfo } from "../protocol/account";

/** 認証情報や会話内容を含まない保存形式。 */
export type CodexModelSelection = { model: string; reasoning: string };

/** スライダーとモデル切り替えで共通に使う推論量の順序。 */
export const reasoningLevels = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
];

/** 対応値を維持し、上限を超える場合だけ切り替え先の最大値へ下げる。 */
export function modelReasoning(model: ModelInfo, previous = ""): string {
	const supported = model.supportedReasoningEfforts.map(
		(item) => item.reasoningEffort,
	);
	if (supported.includes(previous)) {
		return previous;
	}
	const maximum = reasoningLevels
		.filter((level) => supported.includes(level))
		.at(-1);
	return isNonEmptyString(maximum) &&
		reasoningLevels.indexOf(previous) > reasoningLevels.indexOf(maximum)
		? maximum
		: model.defaultReasoningEffort;
}

/** VS Code とテストで保存先を差し替える。 */
export type CodexSelectionStore = {
	read():
		| CodexModelSelection
		| undefined
		| Promise<CodexModelSelection | undefined>;
	write(selection: CodexModelSelection): Promise<void>;
};

/** 保存先から既知の形式だけを読み、モデル候補との検証に渡す。 */
export function codexSelectionStore(storage: {
	read(): unknown;
	write(value: CodexModelSelection): PromiseLike<void>;
}): CodexSelectionStore {
	return {
		read: async () => {
			const value = await storage.read();
			if (
				!isRecord(value) ||
				typeof value.model !== "string" ||
				value.model.trim() === ""
			) {
				return undefined;
			}
			return {
				model: value.model.trim(),
				reasoning:
					typeof value.reasoning === "string" ? value.reasoning : "",
			};
		},
		write: (selection) => Promise.resolve(storage.write(selection)),
	};
}

/** 無効な保存モデルはサーバーの初期モデル、次に利用可能な候補へ戻す。 */
export function resolveCodexSelection(
	saved: CodexModelSelection | undefined,
	models: ModelInfo[],
	initialModel: string,
): CodexModelSelection | undefined {
	if (!saved) {
		return undefined;
	}
	const model =
		models.find((item) => item.model === saved.model) ??
		models.find((item) => item.model === initialModel) ??
		models[0];
	if (!model) {
		return undefined;
	}
	const reasoning =
		model.model === saved.model
			? model.supportedReasoningEfforts.find(
					(item) => item.reasoningEffort === saved.reasoning,
				)?.reasoningEffort
			: undefined;
	return {
		model: model.model,
		reasoning: reasoning ?? model.defaultReasoningEffort,
	};
}
