// 通常の質問を順に収集し、取消時は回答全体を破棄する。
import { isRecord } from "../../../shared/validation";
import { AppServerRpcError } from "../protocol/rpcMessage";
import { text, type InteractionService } from "./interactionService";

/** 質問の選択肢と自由入力を順に収集し、取消時に回答を送信しない。 */
export async function userInput(
	p: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
) {
	if (!Array.isArray(p.questions)) {
		throw new AppServerRpcError(-32602, "Invalid questions");
	}
	const answers = Object.create(null) as Record<
		string,
		{ answers: string[] }
	>;
	for (const question of p.questions as unknown[]) {
		if (!isRecord(question)) {
			throw new AppServerRpcError(-32602, "Invalid question");
		}
		const id = text(question.id),
			title = text(question.question);
		let answer: string | undefined;
		if (
			Array.isArray(question.options) &&
			question.options.length &&
			!question.isSecret
		) {
			const labels = question.options.map((option: unknown) => {
				if (!isRecord(option)) {
					throw new AppServerRpcError(-32602, "Invalid option");
				}
				return text(option.label);
			});
			if (question.isOther) {
				labels.push("自由に入力する");
			}
			answer = await ui.choose(title, labels, signal);
			if (question.isOther && answer === "自由に入力する") {
				answer = await ui.input(title, false, signal);
			}
		} else {
			answer = await ui.input(title, question.isSecret === true, signal);
		}
		if (signal.aborted || answer === undefined) {
			return { answers: {} };
		}
		answers[id] = { answers: [answer] };
	}
	return { answers };
}
