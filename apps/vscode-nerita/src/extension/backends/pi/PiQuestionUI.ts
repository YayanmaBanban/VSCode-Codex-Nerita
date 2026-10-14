// Pi の標準ダイアログとモデル用質問ツールを、Host の共通質問カードへ接続する。
import { z } from "zod";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	questionFieldSchema,
	type QuestionField,
} from "@nerita/shared/questions";
import type { QuestionAsk } from "../../session/ChatQuestions";

/** SDK の UI を基に、選択・確認・入力のダイアログを質問カードに置き換える。 */
export function piQuestionUI(
	base: ExtensionUIContext,
	ask: QuestionAsk,
	lifetime: AbortSignal,
): ExtensionUIContext {
	/** 1つの SDK ダイアログを質問カードに変換し、回答を元の Promise に返す。 */
	const answer = async (
		title: string,
		field: QuestionField,
		opts?: ExtensionUIDialogOptions,
	) => {
		const result = await ask(
			{ title, source: "Pi", fields: [field] },
			dialogSignal(lifetime, opts),
		);
		return result.action === "accept"
			? (result.answers.answer ?? "")
			: undefined;
	};
	return {
		...base,
		select: (title, options, opts) =>
			answer(
				title,
				{
					id: "answer",
					title,
					required: true,
					options: options.map((label) => ({ label })),
				},
				opts,
			),
		confirm: async (title, message, opts) =>
			(await answer(
				title,
				{
					id: "answer",
					title: message,
					required: true,
					options: [{ label: "はい" }, { label: "いいえ" }],
				},
				opts,
			)) === "はい",
		input: (title, placeholder, opts) =>
			answer(
				title,
				{
					id: "answer",
					title,
					required: false,
					...(placeholder !== undefined ? { placeholder } : {}),
				},
				opts,
			),
		editor: (title, prefill) =>
			answer(title, {
				id: "answer",
				title,
				required: false,
				multiline: true,
				...(prefill !== undefined ? { prefill } : {}),
			}),
		custom: () =>
			Promise.reject(
				new Error(
					"Piの端末専用カスタムUIはチャットでは利用できません。select・confirm・input・editorを使用してください。",
				),
			),
	};
}

/** SDK からの取消しとタイムアウトを、接続の取消しと合成する。 */
function dialogSignal(
	lifetime: AbortSignal,
	opts?: ExtensionUIDialogOptions,
): AbortSignal {
	const signals = [lifetime];
	if (opts?.signal) {
		signals.push(opts.signal);
	}
	if (opts?.timeout !== undefined) {
		signals.push(
			AbortSignal.timeout(Math.max(0, Math.floor(opts.timeout))),
		);
	}
	return AbortSignal.any(signals);
}

const toolInput = z.object({
	title: z.string(),
	questions: z
		.array(questionFieldSchema.omit({ secret: true, prefill: true }))
		.min(1)
		.max(100),
});

/** 複数質問と選択肢の説明を一括で提示し、同じモデル実行へ回答を返す。 */
export function createPiQuestionTool(
	ask: QuestionAsk,
	lifetime: AbortSignal,
): ToolDefinition {
	return {
		name: "request_user_input",
		label: "ユーザーへの質問",
		description:
			"Ask the user one or more questions before continuing. Use stable question ids and titles, required true for mandatory answers, options with labels and optional descriptions, and allowOther true to allow a custom answer. The tool waits for the user's response without starting a new conversation.",
		exposure: "model-only",
		executionMode: "sequential",
		parameters: {
			type: "object",
			...z.toJSONSchema(toolInput, { io: "input" }),
		},
		async execute(_id, params, signal) {
			const input = toolInput.parse(params);
			const combined = AbortSignal.any([
				lifetime,
				...(signal ? [signal] : []),
			]);
			const result = await ask(
				{ title: input.title, source: "Pi", fields: input.questions },
				combined,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: { action: result.action },
			};
		},
	};
}
