// バックエンドの質問を共通カードへ渡し、回答を元の要求だけに返す通信契約。
import { z } from "zod";

const id = z.string().min(1).max(200);
const optionSchema = z.object({
	label: z.string().min(1),
	description: z.string().optional(),
});
export const questionFieldSchema = z.object({
	id,
	title: z.string(),
	description: z.string().optional(),
	options: z
		.array(optionSchema)
		.max(100)
		.refine(
			(options) =>
				new Set(options.map((option) => option.label)).size ===
				options.length,
		)
		.optional(),
	allowOther: z.boolean().optional(),
	secret: z.boolean().optional(),
	multiline: z.boolean().optional(),
	placeholder: z.string().optional(),
	prefill: z.string().optional(),
	required: z.boolean(),
	inputType: z.enum(["string", "number", "integer"]).optional(),
	minimum: z.number().optional(),
	maximum: z.number().optional(),
	minLength: z.number().int().nonnegative().optional(),
	maxLength: z.number().int().nonnegative().optional(),
});
/** 入力値は文字列で返し、バックエンドが指定された型へ変換する。 */
export type QuestionField = z.infer<typeof questionFieldSchema>;
export const questionSpecSchema = z.object({
	title: z.string(),
	source: z.enum(["Codex", "Pi", "MCP"]),
	fields: z
		.array(questionFieldSchema)
		.max(100)
		.refine(
			(fields) =>
				new Set(fields.map((field) => field.id)).size === fields.length,
		),
	allowDecline: z.boolean().optional(),
});
/** 1つの要求に含める質問の定義。項目 ID は要求内で一意にする。 */
export type QuestionSpec = z.infer<typeof questionSpecSchema>;
const questionRequestSchema = questionSpecSchema.extend({
	id,
	sessionId: id,
	runId: id.nullable(),
	error: z.string().optional(),
});
/** 回答本文はこの状態に保持せず、送信要求でだけ Host に渡す。 */
export type QuestionRequest = z.infer<typeof questionRequestSchema>;
const answerSchema = z.object({
	action: z.enum(["accept", "cancel", "decline"]),
	answers: z.record(id, z.string().max(100_000)),
});
/** 取消・拒否では回答本文を返さない。 */
export type QuestionAnswer = z.infer<typeof answerSchema>;
const responseSchema = answerSchema.extend({
	type: z.literal("question/respond"),
	requestId: id,
	questionId: id,
	sessionId: id,
	runId: id.nullable(),
});
/** 表示時の質問・会話・実行 ID を必ず付け、古い画面の回答と区別する。 */
export type QuestionResponse = z.infer<typeof responseSchema>;
/** Host から受け取ったカードの通信型を確認する。 */
export function isQuestionRequest(value: unknown): value is QuestionRequest {
	return questionRequestSchema.safeParse(value).success;
}
/** 回答本文の長さと返信先を副作用の前に確認する。 */
export function isQuestionResponse(value: unknown): value is QuestionResponse {
	return responseSchema.safeParse(value).success;
}
/** 必須入力、選択肢、数値・文字数の制約を両側で照合する。 */
export function questionFieldError(
	field: QuestionField,
	value: string,
): string | undefined {
	if (value === "") {
		return field.required ? "入力してください。" : undefined;
	}
	const invalidChoice =
		field.options &&
		field.allowOther !== true &&
		!field.options.some((option) => option.label === value);
	if (invalidChoice === true) {
		return "選択肢から選んでください。";
	}
	if (invalidQuestionNumber(field, value)) {
		return "指定範囲の数値を入力してください。";
	}
	return questionLengthError(field, value);
}

/** 文字数の制約は、選択や数値の検証とは独立して照合する。 */
function questionLengthError(
	field: QuestionField,
	value: string,
): string | undefined {
	if (field.minLength !== undefined && value.length < field.minLength) {
		return "指定された文字数で入力してください。";
	}
	if (field.maxLength !== undefined && value.length > field.maxLength) {
		return "指定された文字数で入力してください。";
	}
	return undefined;
}

/** 空白だけの数値や整数型に対する小数も拒否する。 */
function invalidQuestionNumber(field: QuestionField, value: string): boolean {
	if (field.inputType !== "number" && field.inputType !== "integer") {
		return false;
	}
	const number = Number(value);
	const invalidInteger =
		field.inputType === "integer" && !Number.isInteger(number);
	const invalidNumber =
		value.trim() === "" || !Number.isFinite(number) || invalidInteger;
	if (invalidNumber) {
		return true;
	}
	if (field.minimum !== undefined && number < field.minimum) {
		return true;
	}
	return field.maximum !== undefined && number > field.maximum;
}
