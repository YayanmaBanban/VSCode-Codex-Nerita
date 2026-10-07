// MCP の URL 誘導と基本フォームを検証し、承諾した入力だけを返す。
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { isRecord } from "@nerita/shared/validation";
import { text, type InteractionService } from "./interactionService";

/** MCP の基本フォームを型と制約で検証し、未対応形式は承諾しない。 */
export async function elicitation(
	p: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
) {
	const empty = { action: "cancel", content: null, _meta: null };
	const title = `${text(p.serverName)}: ${text(p.message)}`;
	if (p.mode === "url") {
		return elicitUrl(p, ui, signal, title, empty);
	}
	const schema = p.requestedSchema;
	if (
		!isRecord(schema) ||
		schema.type !== "object" ||
		!isRecord(schema.properties)
	) {
		return { ...empty, action: "decline" };
	}
	return elicitForm(schema, schema.properties, ui, signal, title, empty);
}

/** 各項目を順に収集し、最後に送信を確認する。 */
async function elicitForm(
	schema: Record<string, unknown>,
	properties: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
	title: string,
	empty: { action: string; content: null; _meta: null },
) {
	const content: Record<string, unknown> = { __proto__: null };
	for (const [key, field] of Object.entries(properties)) {
		if (!supportedField(field)) {
			return { ...empty, action: "decline" };
		}
		const required =
			Array.isArray(schema.required) && schema.required.includes(key);
		const answer = await elicitField(
			field,
			required,
			fieldPrompt(title, field, key, required),
			ui,
			signal,
		);
		if (answer === undefined) {
			return empty;
		}
		if (answer !== null) {
			content[key] = answer.value;
		}
	}
	if (
		(await ui.choose(title, ["送信", "中止"], signal)) !== "送信" ||
		signal.aborted
	) {
		return empty;
	}
	return { action: "accept", content, _meta: null };
}

/** フォーム項目の説明と必須表示を組み立てる。 */
function fieldPrompt(
	title: string,
	field: SupportedField,
	key: string,
	required: boolean,
) {
	return `${title}\n${typeof field.title === "string" ? field.title : key}${required ? "（必須）" : "（省略可）"}${typeof field.description === "string" ? `\n${field.description}` : ""}`;
}

/** 数値の型と上下限を照合する。 */
function invalidNumber(number: number, field: SupportedField) {
	return (
		!Number.isFinite(number) ||
		(field.type === "integer" && !Number.isInteger(number)) ||
		(typeof field.minimum === "number" && number < field.minimum) ||
		(typeof field.maximum === "number" && number > field.maximum)
	);
}

/** 基本フォームとして扱えない型や制約を拒否する。 */
const supportedFieldSchema = z
	.object({
		type: z.enum(["string", "number", "integer", "boolean"]),
		title: z.string().optional(),
		description: z.string().optional(),
		minimum: z.number().optional(),
		maximum: z.number().optional(),
		minLength: z.number().int().nonnegative().optional(),
		maxLength: z.number().int().nonnegative().optional(),
		enum: z
			.array(z.union([z.string(), z.number(), z.boolean()]))
			.nonempty()
			.optional(),
	})
	.refine(
		(field) =>
			(field.minimum === undefined ||
				field.maximum === undefined ||
				field.minimum <= field.maximum) &&
			(field.minLength === undefined ||
				field.maxLength === undefined ||
				field.minLength <= field.maxLength) &&
			(field.enum === undefined ||
				field.enum.every((value) =>
					field.type === "integer"
						? typeof value === "number" && Number.isInteger(value)
						: typeof value === field.type,
				)),
	);
type SupportedField = z.infer<typeof supportedFieldSchema>;

/** 未対応の制約を拒否し、対応する型と各制約の値を保証する。 */
function supportedField(field: unknown): field is SupportedField {
	return (
		isRecord(field) &&
		supportedFieldSchema.safeParse(field).success &&
		!Boolean(field.format) &&
		!Boolean(field.oneOf) &&
		!Boolean(field.anyOf) &&
		!Boolean(field.pattern) &&
		!Boolean(field.items)
	);
}

/** 任意項目の省略を `null`、取消や不正な入力を `undefined` で区別する。 */
async function elicitField(
	field: SupportedField,
	required: boolean,
	prompt: string,
	ui: InteractionService,
	signal: AbortSignal,
) {
	const choices = fieldChoices(field);
	const validate = (value: string) => validateField(value, field, required);
	const value = choices
		? await ui.choose(
				prompt,
				required ? choices : [...choices, "省略"],
				signal,
			)
		: await ui.input(prompt, false, signal, validate);
	if (signal.aborted || value === undefined) {
		return undefined;
	}
	if (omitField(value, required, choices)) {
		return null;
	}
	if (
		isNonEmptyString(validate(value)) ||
		(choices && !choices.includes(value))
	) {
		return undefined;
	}
	return { value: fieldValue(field.type, value) };
}

/** 任意項目の空入力と明示的な省略を判定する。 */
function omitField(
	value: string,
	required: boolean,
	choices: string[] | undefined,
): boolean {
	return (
		!required &&
		(value === "" || (value === "省略" && choices !== undefined))
	);
}

/** 必須・数値・文字数の制約を入力時と送信前に照合する。 */
function validateField(
	value: string,
	field: SupportedField,
	required: boolean,
): string | undefined {
	if (value === "") {
		return required ? "入力してください。" : undefined;
	}
	if (
		(field.type === "number" || field.type === "integer") &&
		invalidNumber(Number(value), field)
	) {
		return "指定範囲の数値を入力してください。";
	}
	if (
		(typeof field.minLength === "number" &&
			value.length < field.minLength) ||
		(typeof field.maxLength === "number" && value.length > field.maxLength)
	) {
		return "指定された文字数で入力してください。";
	}
	return undefined;
}

/** 列挙値を優先し、真偽値の入力には固定の選択肢を用意する。 */
function fieldChoices(field: SupportedField) {
	if (Array.isArray(field.enum)) {
		return field.enum.map(String);
	}
	if (field.type === "boolean") {
		return ["true", "false"];
	}
	return undefined;
}

/** 検証済みの入力文字列をフォームの宣言型へ変換する。 */
function fieldValue(type: SupportedField["type"], value: string) {
	if (type === "boolean") {
		return value === "true";
	}
	if (type === "string") {
		return value;
	}
	return Number(value);
}

/** 許可された URL で入力を促し、ユーザーの完了確認を待つ。 */
async function elicitUrl(
	p: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
	title: string,
	empty: { action: string; content: null; _meta: null },
) {
	const url = new URL(text(p.url));
	if (
		url.protocol !== "https:" &&
		!(
			url.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
		)
	) {
		return { ...empty, action: "decline" };
	}
	if (
		(await ui.choose(
			`${title}\n${url.href}`,
			["ブラウザで開く", "拒否"],
			signal,
		)) !== "ブラウザで開く" ||
		signal.aborted
	) {
		return empty;
	}
	await ui.open(url.href);
	const answer = await ui.choose(title, ["入力を完了した", "中止"], signal);
	return {
		...empty,
		action:
			// 確認待ちの間に AbortSignal は変更されるため、返答後にも取消しを確認する。
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			answer === "入力を完了した" && !signal.aborted
				? "accept"
				: "cancel",
	};
}
