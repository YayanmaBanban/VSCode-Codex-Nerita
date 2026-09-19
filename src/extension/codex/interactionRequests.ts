// サーバーからの質問・MCPフォームを、取消可能なHostの入力UIへ接続する。
import { isRecord } from "../../shared/validation";
import { AppServerRpcError, type AppServerRequest } from "./protocol/rpcMessage";

/** 秘密入力や選択をWebviewの永続状態に残さないための境界。 */
export type InteractionService = {
	input: (
		title: string,
		secret: boolean,
		signal: AbortSignal,
		validate?: (value: string) => string | undefined,
	) => Promise<string | undefined>;
	choose: (
		title: string,
		choices: string[],
		signal: AbortSignal,
	) => Promise<string | undefined>;
	open: (url: string) => Promise<void>;
};
/** 入力要求の必須文字列を検証する。 */
function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new AppServerRpcError(-32602, "Invalid request");
	}
	return value;
}
/** 質問の選択肢と自由入力を順に収集し、取消時に回答を送信しない。 */
async function userInput(
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
/** MCPの基本フォームを型と制約で検証し、未対応形式は承諾しない。 */
async function elicitation(
	p: Record<string, unknown>,
	ui: InteractionService,
	signal: AbortSignal,
) {
	const empty = { action: "cancel", content: null, _meta: null };
	const title = `${text(p.serverName)}: ${text(p.message)}`;
	if (p.mode === "url") {
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
		const answer = await ui.choose(
			title,
			["入力を完了した", "中止"],
			signal,
		);
		return {
			...empty,
			action:
				answer === "入力を完了した" && !signal.aborted
					? "accept"
					: "cancel",
		};
	}
	const schema = p.requestedSchema;
	if (
		!isRecord(schema) ||
		schema.type !== "object" ||
		!isRecord(schema.properties)
	) {
		return { ...empty, action: "decline" };
	}
	const content = Object.create(null) as Record<string, unknown>;
	for (const [key, field] of Object.entries(schema.properties)) {
		if (
			!isRecord(field) ||
			!["string", "number", "integer", "boolean"].includes(
				String(field.type),
			) ||
			field.format ||
			field.oneOf ||
			field.anyOf ||
			field.pattern ||
			field.items
		) {
			return { ...empty, action: "decline" };
		}
		const required =
			Array.isArray(schema.required) && schema.required.includes(key);
		const prompt = `${title}\n${typeof field.title === "string" ? field.title : key}${required ? "（必須）" : "（省略可）"}${typeof field.description === "string" ? `\n${field.description}` : ""}`;
		const choices = Array.isArray(field.enum)
			? field.enum.map(text)
			: field.type === "boolean"
				? ["true", "false"]
				: undefined;
		const validate = (value: string): string | undefined => {
			if (!value) {
				return required ? "入力してください。" : undefined;
			}
			if (field.type === "number" || field.type === "integer") {
				const number = Number(value);
				if (
					!Number.isFinite(number) ||
					(field.type === "integer" && !Number.isInteger(number)) ||
					(typeof field.minimum === "number" &&
						number < field.minimum) ||
					(typeof field.maximum === "number" &&
						number > field.maximum)
				) {
					return "指定範囲の数値を入力してください。";
				}
			}
			if (
				(typeof field.minLength === "number" &&
					value.length < field.minLength) ||
				(typeof field.maxLength === "number" &&
					value.length > field.maxLength)
			) {
				return "指定された文字数で入力してください。";
			}
			return undefined;
		};
		const value = choices
			? await ui.choose(
					prompt,
					required ? choices : [...choices, "省略"],
					signal,
				)
			: await ui.input(prompt, false, signal, validate);
		if (signal.aborted || value === undefined) {
			return empty;
		}
		if (value === "省略" && !required && choices) {
			continue;
		}
		if (!required && !value) {
			continue;
		}
		if (validate(value) || (choices && !choices.includes(value))) {
			return empty;
		}
		content[key] =
			field.type === "boolean"
				? value === "true"
				: field.type === "string"
					? value
					: Number(value);
	}
	if (
		(await ui.choose(title, ["送信", "中止"], signal)) !== "送信" ||
		signal.aborted
	) {
		return empty;
	}
	return { action: "accept", content, _meta: null };
}
/** クライアントが提供していない動的ツールや認証更新要求を実行しない。 */
export async function interactionRequest(
	request: AppServerRequest,
	ui: InteractionService,
	signal: AbortSignal,
): Promise<unknown> {
	if (!isRecord(request.params)) {
		throw new AppServerRpcError(-32602, "Invalid request");
	}
	if (request.method === "item/tool/requestUserInput") {
		return userInput(request.params, ui, signal);
	}
	if (request.method === "mcpServer/elicitation/request") {
		return elicitation(request.params, ui, signal);
	}
	throw new AppServerRpcError(-32601, "Method not supported by this client");
}
