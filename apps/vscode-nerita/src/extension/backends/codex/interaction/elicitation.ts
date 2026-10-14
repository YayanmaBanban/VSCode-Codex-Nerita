// MCP の URL 誘導と基本フォームを検証し、承諾した入力だけを返す。
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { isRecord } from "@nerita/shared/validation";
import { text, type InteractionService } from "./interactionService";
import type { QuestionField } from "@nerita/shared/questions";

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

	if (!isRecord(schema)) {
		return { ...empty, action: "decline" };
	}
	if (schema.type !== "object") {
		return { ...empty, action: "decline" };
	}
	if (!isRecord(schema.properties)) {
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
	if (ui.ask) {
		return elicitChatForm(schema, properties, ui.ask, signal, title, empty);
	}
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
	const matchesValue =
		(await ui.choose(title, ["送信", "中止"], signal)) !== "送信" ||
		signal.aborted;
	if (matchesValue) {
		return empty;
	}
	return { action: "accept", content, _meta: null };
}

/** フォーム全体を1枚のカードで確認し、指定された型に回答を変換して MCP に返す。 */
async function elicitChatForm(
	schema: Record<string, unknown>,
	properties: Record<string, unknown>,
	ask: NonNullable<InteractionService["ask"]>,
	signal: AbortSignal,
	title: string,
	empty: { action: string; content: null; _meta: null },
) {
	const fields: QuestionField[] = [];
	for (const [key, field] of Object.entries(properties)) {
		if (!supportedField(field)) {
			return { ...empty, action: "decline" };
		}
		fields.push(
			chatFormField(
				key,
				field,
				Array.isArray(schema.required) && schema.required.includes(key),
			),
		);
	}
	const result = await ask(
		{ title, source: "MCP", fields, allowDecline: true },
		signal,
	);
	if (signal.aborted || result.action !== "accept") {
		return { ...empty, action: result.action };
	}
	const content: Record<string, unknown> = { __proto__: null };
	for (const [key, field] of Object.entries(properties)) {
		const value = result.answers[key] ?? "";
		if (value !== "" && supportedField(field)) {
			content[key] = fieldValue(field.type, value);
		}
	}
	return { action: "accept", content, _meta: null };
}

/** 型と制約を Webview に渡し、任意項目は空入力で省略できるようにする。 */
function chatFormField(
	key: string,
	field: SupportedField,
	required: boolean,
): QuestionField {
	const choices = fieldChoices(field);
	return {
		id: key,
		title: field.title ?? key,
		required,
		...(field.description !== undefined
			? { description: field.description }
			: {}),
		...(choices ? { options: choices.map((label) => ({ label })) } : {}),
		...(field.type !== "boolean" ? { inputType: field.type } : {}),
		...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
		...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
		...(field.minLength !== undefined
			? { minLength: field.minLength }
			: {}),
		...(field.maxLength !== undefined
			? { maxLength: field.maxLength }
			: {}),
	};
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
	const invalidNumberCheck =
		!Number.isFinite(number) ||
		(field.type === "integer" && !Number.isInteger(number));

	if (invalidNumberCheck) {
		return true;
	}
	if (typeof field.minimum === "number" && number < field.minimum) {
		return true;
	}
	return typeof field.maximum === "number" && number > field.maximum;
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
	.refine((field) => {
		const matchesMinimum = !(
			field.minimum === undefined ||
			field.maximum === undefined ||
			field.minimum <= field.maximum
		);
		if (matchesMinimum) {
			return false;
		}
		const matchesMinLength = !(
			field.minLength === undefined ||
			field.maxLength === undefined ||
			field.minLength <= field.maxLength
		);
		if (matchesMinLength) {
			return false;
		}
		const matchesEnum =
			field.enum === undefined ||
			field.enum.every((value) =>
				field.type === "integer"
					? typeof value === "number" && Number.isInteger(value)
					: typeof value === field.type,
			);
		return matchesEnum;
	});
/** 対応する入力要求のフィールド。外部入力は `supportedFieldSchema` で検証してから扱う。 */
type SupportedField = z.infer<typeof supportedFieldSchema>;

/** 未対応の制約を拒否し、対応する型と各制約の値を保証する。 */
function supportedField(field: unknown): field is SupportedField {
	if (!isRecord(field)) {
		return false;
	}
	if (!supportedFieldSchema.safeParse(field).success) {
		return false;
	}
	if (Boolean(field.format)) {
		return false;
	}
	const matchesBoolean = !(
		!Boolean(field.oneOf) &&
		!Boolean(field.anyOf) &&
		!Boolean(field.pattern)
	);
	if (matchesBoolean) {
		return false;
	}
	return !Boolean(field.items);
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
	/** 要求されたフィールドと必須条件を固定し、対話入力を共通の検証処理へ渡す。 */
	const validate = (value: string) => validateField(value, field, required);
	let value: string | undefined;
	if (choices) {
		const options = required ? choices : [...choices, "省略"];
		value = await ui.choose(prompt, options, signal);
	} else {
		value = await ui.input(prompt, false, signal, validate);
	}
	if (signal.aborted || value === undefined) {
		return undefined;
	}
	if (omitField(value, required, choices)) {
		return null;
	}

	if (isNonEmptyString(validate(value))) {
		return undefined;
	}
	if (choices && !choices.includes(value)) {
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
	if (required) {
		return false;
	}
	return value === "" || (value === "省略" && choices !== undefined);
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
	const matchesType =
		(field.type === "number" || field.type === "integer") &&
		invalidNumber(Number(value), field);
	if (matchesType) {
		return "指定範囲の数値を入力してください。";
	}
	if (typeof field.minLength === "number" && value.length < field.minLength) {
		return "指定された文字数で入力してください。";
	}
	if (typeof field.maxLength === "number" && value.length > field.maxLength) {
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
	const matchesProtocol =
		url.protocol !== "https:" &&
		!(
			url.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
		);
	if (matchesProtocol) {
		return { ...empty, action: "decline" };
	}
	if (ui.ask) {
		return elicitChatUrl(url, ui, signal, title, empty);
	}
	const matchesValue2 =
		(await ui.choose(
			`${title}\n${url.href}`,
			["ブラウザで開く", "拒否"],
			signal,
		)) !== "ブラウザで開く" || signal.aborted;
	if (matchesValue2) {
		return empty;
	}
	await ui.open(url.href);
	const answer = await ui.choose(title, ["入力を完了した", "中止"], signal);
	return {
		...empty,
		action:
			// 確認待ちの間に `AbortSignal` の状態が変わることもあるため、返答後にも取り消しを確認する。
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			answer === "入力を完了した" && !signal.aborted
				? "accept"
				: "cancel",
	};
}

/** URL を開く承諾と入力完了を同じチャットで確認し、拒否と取消を区別する。 */
async function elicitChatUrl(
	url: URL,
	ui: InteractionService,
	signal: AbortSignal,
	title: string,
	empty: { action: string; content: null; _meta: null },
) {
	const ask = ui.ask!;
	const requested = await ask(
		{
			title,
			source: "MCP",
			allowDecline: true,
			fields: [
				{
					id: "open",
					title: "ブラウザーで開きますか？",
					description: url.href,
					required: true,
					options: [{ label: "ブラウザーで開く" }],
				},
			],
		},
		signal,
	);
	if (requested.action !== "accept") {
		return { ...empty, action: requested.action };
	}
	if (signal.aborted) {
		return empty;
	}
	await ui.open(url.href);
	const completed = await ask(
		{
			title,
			source: "MCP",
			fields: [
				{
					id: "done",
					title: "ブラウザーでの入力を完了したら回答してください。",
					required: true,
					options: [{ label: "入力を完了した" }],
				},
			],
		},
		signal,
	);
	return {
		...empty,
		action: completed.action === "accept" ? "accept" : "cancel",
	};
}
