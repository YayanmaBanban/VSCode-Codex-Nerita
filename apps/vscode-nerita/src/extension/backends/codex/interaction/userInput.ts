// 通常の質問を一括または順番に表示し、取り消し時は回答全体を破棄する。
import { isRecord } from "@nerita/shared/validation";
import { AppServerRpcError } from "../protocol/rpcMessage";
import { text, type InteractionService } from "./interactionService";
import type { QuestionField } from "@nerita/shared/questions";

/** チャットでは質問をまとめて表示し、取り消し時は回答を返さない。 */
export async function userInput(
	p: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
) {
	if (!Array.isArray(p.questions)) {
		throw new AppServerRpcError(-32602, "Invalid questions");
	}
	if (ui.ask) {
		const result = await ui.ask(
			{
				title: "確認したいことがあります",
				source: "Codex",
				fields: p.questions.map(questionField),
			},
			signal,
		);
		if (result.action !== "accept" || signal.aborted) {
			return { answers: {} };
		}
		return {
			answers: Object.fromEntries(
				Object.entries(result.answers).map(([id, answer]) => [
					id,
					{ answers: [answer] },
				]),
			),
		};
	}
	const answers: Record<string, { answers: string[] }> = {};
	Object.setPrototypeOf(answers, null);
	for (const question of p.questions as unknown[]) {
		if (!isRecord(question)) {
			throw new AppServerRpcError(-32602, "Invalid question");
		}
		const id = text(question.id),
			title = text(question.question);
		const answer: string | undefined = await questionAnswer(
			question,
			ui,
			title,
			signal,
		);
		if (signal.aborted || answer === undefined) {
			return { answers: {} };
		}
		answers[id] = { answers: [answer] };
	}
	return { answers };
}

/** 秘密入力には選択肢を表示せず、通常の質問では説明と自由入力を保持する。 */
function questionField(value: unknown): QuestionField {
	if (!isRecord(value)) {
		throw new AppServerRpcError(-32602, "Invalid question");
	}
	const field: QuestionField = {
		id: text(value.id),
		title: text(value.question),
		required: true,
		secret: value.isSecret === true,
	};
	if (typeof value.header === "string") {
		field.description = value.header;
	}
	if (hasSelectableOptions(value)) {
		field.options = value.options.map((option: unknown) => {
			if (!isRecord(option)) {
				throw new AppServerRpcError(-32602, "Invalid option");
			}
			return {
				label: text(option.label),
				...(typeof option.description === "string"
					? { description: option.description }
					: {}),
			};
		});
		field.allowOther = value.isOther === true;
	}
	return field;
}

/** 質問の選択肢と自由入力を扱う。 */
async function questionAnswer(
	question: Record<string, unknown>,
	ui: InteractionService,
	title: string,
	signal: AbortSignal,
) {
	let answer: string | undefined;
	if (hasSelectableOptions(question)) {
		const labels = question.options.map((option: unknown) => {
			if (!isRecord(option)) {
				throw new AppServerRpcError(-32602, "Invalid option");
			}
			return text(option.label);
		});
		if (Boolean(question.isOther)) {
			labels.push("自由に入力する");
		}
		answer = await ui.choose(title, labels, signal);
		if (Boolean(question.isOther) && answer === "自由に入力する") {
			answer = await ui.input(title, false, signal);
		}
	} else {
		answer = await ui.input(title, question.isSecret === true, signal);
	}
	return answer;
}

/** 秘密入力や空の選択肢は自由入力へ回し、選択処理に渡す配列だけを型保証する。 */
function hasSelectableOptions(
	question: Record<string, unknown>,
): question is Record<string, unknown> & { options: unknown[] } {
	if (!Array.isArray(question.options)) {
		return false;
	}
	return question.options.length > 0 && !Boolean(question.isSecret);
}
