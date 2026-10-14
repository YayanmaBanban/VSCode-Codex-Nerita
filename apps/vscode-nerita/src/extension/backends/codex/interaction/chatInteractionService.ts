// Codex の対話要求を共通のチャット質問へ変換し、外部 URL は Host で開く。
import type { QuestionAsk } from "../../../session/ChatQuestions";
import type { InteractionService } from "./interactionService";

/** 質問をカードに限定し、URL の起動だけをプラットフォームへ委ねる。 */
export function chatInteractionService(
	ask: QuestionAsk,
	open?: InteractionService["open"],
): InteractionService {
	return {
		ask,
		async input(title, secret, signal, validate) {
			const result = await ask(
				{
					title,
					source: "Codex",
					fields: [{ id: "answer", title, secret, required: false }],
				},
				signal,
				validate
					? (answers) => validate(answers.answer ?? "")
					: undefined,
			);
			return result.action === "accept"
				? (result.answers.answer ?? "")
				: undefined;
		},
		async choose(title, choices, signal) {
			const result = await ask(
				{
					title,
					source: "Codex",
					fields: [
						{
							id: "answer",
							title,
							required: true,
							options: choices.map((label) => ({ label })),
						},
					],
				},
				signal,
			);
			return result.action === "accept"
				? result.answers.answer
				: undefined;
		},
		open:
			open ??
			(() => Promise.reject(new Error("外部ブラウザーを開けません。"))),
	};
}
