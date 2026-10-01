// 既存本文を優先し、空欄だけ構造化結果の安全な要約で補う。
import type { ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { PiDisplayText } from "./PiDisplayText";
import { piStructuredDisplay } from "./PiStructuredDisplay";

/** MCP の出所は Host の登録情報から渡し、結果自身の自己申告では判定しない。 */
export type PiResultDisplayOptions = {
	mcpEnvelope?: boolean;
	secrets?: readonly string[];
};

/** SDK の内部情報を捨て、表示用本文と必要な由来だけを返す。 */
export function piResultDisplay(
	result: unknown,
	options: PiResultDisplayOptions = {},
): Pick<ToolSummary, "content" | "resultDisplay"> {
	if (!isRecord(result)) {
		return { content: [] };
	}
	const body = bodyContent(ownValue(result, "content"), options);
	if (body.content?.length) {
		return { ...body, ...savedDisplay(result) };
	}
	const value = structuredValue(
		ownValue(result, "structuredContent"),
		options,
	);
	if (value === undefined) {
		return { content: [] };
	}
	const display = piStructuredDisplay(value, options.secrets);
	return {
		content: [textContent(display.text)],
		resultDisplay: {
			source: "structuredContent",
			omitted: display.omitted,
		},
	};
}

/** Host が保存した表示元と省略情報だけを引き継ぎ、任意の結果データは公開しない。 */
function savedDisplay(result: object): Pick<ToolSummary, "resultDisplay"> {
	const details = ownValue(result, "details");
	const display = isRecord(details)
		? ownValue(details, "resultDisplay")
		: undefined;
	if (!isRecord(display)) {
		return {};
	}
	const source = ownValue(display, "source");
	const omitted = ownValue(display, "omitted");
	return (source === "content" || source === "structuredContent") &&
		typeof omitted === "boolean"
		? { resultDisplay: { source, omitted } }
		: {};
}

/** 包まれた MCP 結果は、Host が明示した経路でのみ展開する。 */
function structuredValue(
	value: unknown,
	options: PiResultDisplayOptions,
): unknown {
	if (!options.mcpEnvelope) {
		return value;
	}
	return isRecord(value) ? ownValue(value, "structuredContent") : undefined;
}

/** MCP の本文も秘密値と出力上限を適用し、画像説明は維持する。 */
function bodyContent(
	value: unknown,
	options: PiResultDisplayOptions,
): Pick<ToolSummary, "content" | "resultDisplay"> {
	if (!Array.isArray(value)) {
		return { content: [] };
	}
	const bounded = options.mcpEnvelope || !!options.secrets?.length;
	if (!bounded) {
		return {
			content: value.flatMap((part: unknown) => {
				const text = bodyText(part);
				return text === undefined ? [] : [textContent(text)];
			}),
		};
	}
	return boundedBody(value, options.secrets ?? []);
}

/** MCP 本文の件数・文字列・全体予算を、構造化結果と同じ上限で管理する。 */
function boundedBody(
	value: unknown[],
	secrets: readonly string[],
): Pick<ToolSummary, "content" | "resultDisplay"> {
	const output = new PiDisplayText();
	let visited = 0;
	let count = 0;
	for (const part of value) {
		if (visited++ >= 50) {
			output.omitted = true;
			break;
		}
		const text = bodyText(part);
		if (text === undefined) {
			continue;
		}
		if (count++) {
			output.append("\n");
		}
		output.append(output.string(text, secrets));
		if (output.full) {
			output.omitted = true;
			break;
		}
	}
	return count
		? {
				content: [textContent(output.finish())],
				resultDisplay: { source: "content", omitted: output.omitted },
			}
		: { content: [] };
}

/** 空白だけの本文を無視し、画像データは説明に置き換える。 */
function bodyText(part: unknown): string | undefined {
	if (!isRecord(part)) {
		return;
	}
	const type = ownValue(part, "type");
	const text = ownValue(part, "text");
	if (type === "text" && typeof text === "string" && /\S/.test(text)) {
		return text;
	}
	if (type === "image") {
		return "画像を読み取りました。";
	}
	return;
}

/** プレーンテキスト用の共有カード形式へ揃える。 */
function textContent(text: string) {
	return { type: "content", content: { type: "text", text } };
}

/** 結果の getter や不正な Proxy を呼び出して表示処理を停止しない。 */
function ownValue(value: object, key: string): unknown {
	try {
		return Object.getOwnPropertyDescriptor(value, key)?.value;
	} catch {
		return undefined;
	}
}
