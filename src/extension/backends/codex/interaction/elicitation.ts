// MCPのURL誘導と基本フォームを検証し、承諾した入力だけを返す。
import { isRecord } from "../../../../shared/validation";
import { text, type InteractionService } from "./interactionService";

/** MCPの基本フォームを型と制約で検証し、未対応形式は承諾しない。 */
export async function elicitation(
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
