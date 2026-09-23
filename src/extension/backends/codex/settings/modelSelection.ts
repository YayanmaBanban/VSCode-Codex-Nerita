// Codexの選択だけを永続化し、起動時は現在のモデル候補で検証する。
import { isRecord } from "../../../../shared/validation";
import type { ModelInfo } from "../protocol/account";

/** 認証情報や会話内容を含まない保存形式。 */
export type CodexModelSelection = { model: string; reasoning: string };

/** VS Codeとテストで保存先を差し替える。 */
export type CodexSelectionStore = {
	read(): CodexModelSelection | undefined;
	write(selection: CodexModelSelection): Promise<void>;
};

/** globalStateの既知の形式だけを読み、Piとは別のキーへ保存する。 */
export function codexSelectionStore(storage: {
	get(key: string): unknown;
	update(key: string, value: unknown): PromiseLike<void>;
}): CodexSelectionStore {
	const key = "nerita.codex.lastModel";
	return {
		read: () => {
			const value = storage.get(key);
			if (
				!isRecord(value) ||
				typeof value.model !== "string" ||
				!value.model.trim()
			) {
				return undefined;
			}
			return {
				model: value.model.trim(),
				reasoning:
					typeof value.reasoning === "string" ? value.reasoning : "",
			};
		},
		write: (selection) => Promise.resolve(storage.update(key, selection)),
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
