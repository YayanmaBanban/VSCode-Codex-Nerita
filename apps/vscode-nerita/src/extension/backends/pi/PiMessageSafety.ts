// SDK のメッセージ構造を維持し、本文・任意データだけを履歴保存前に保護する。
import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { privateFeatureResult, privateFeatureValue } from "./PiFeatureSafety";

/** 判別子・ツールの識別子・状態は置換せず、型付き本文の保護を役割ごとに行う。 */
export function privatePiMessage(
	message: MessageEndEvent["message"],
	protect: (value: string) => string,
): MessageEndEvent["message"] {
	if (message.role === "assistant") {
		return privateAssistantMessage(message, protect);
	}
	if (message.role === "toolResult") {
		return privateToolMessage(message, protect);
	}
	if (message.role === "user") {
		return {
			...message,
			content:
				typeof message.content === "string"
					? protect(message.content)
					: privateFeatureResult(
							{ content: message.content, details: undefined },
							[],
							protect,
						).content,
		};
	}
	if (message.role === "system") {
		return {
			...message,
			content:
				typeof message.content === "string"
					? protect(message.content)
					: message.content.map((part) => ({
							...part,
							text: protect(part.text),
						})),
		};
	}
	// 拡張の独自メッセージも、宣言済みの表示本文を保護する。
	if (message.role === "custom") {
		return {
			...message,
			details: privateFeatureValue(message.details, [], protect),
			content:
				typeof message.content === "string"
					? protect(message.content)
					: privateFeatureResult(
							{ content: message.content, details: undefined },
							[],
							protect,
						).content,
		};
	}
	if (message.role === "bashExecution") {
		return {
			...message,
			command: protect(message.command),
			output: protect(message.output),
		};
	}
	return { ...message, summary: protect(message.summary) };
}

/** アシスタント本文と任意のツール引数を、制御フィールドから分けて保護する。 */
function privateAssistantMessage(
	message: Extract<MessageEndEvent["message"], { role: "assistant" }>,
	protect: (value: string) => string,
): MessageEndEvent["message"] {
	return {
		...message,
		...(message.errorMessage === undefined
			? {}
			: { errorMessage: protect(message.errorMessage) }),
		content: message.content.map((part) => {
			if (part.type === "text") {
				return { ...part, text: protect(part.text) };
			}
			if (part.type === "thinking") {
				return { ...part, thinking: protect(part.thinking) };
			}
			return {
				...part,
				arguments: z
					.record(z.string(), z.json())
					.parse(privateFeatureValue(part.arguments, [], protect)),
			};
		}),
	};
}

/** ツール結果と子の診断記録を保護し、呼出し ID と完了状態を保持する。 */
function privateToolMessage(
	message: Extract<MessageEndEvent["message"], { role: "toolResult" }>,
	protect: (value: string) => string,
): MessageEndEvent["message"] {
	const result = privateFeatureResult(
		{ content: message.content, details: message.details },
		[],
		protect,
	);
	return {
		...message,
		content: result.content,
		...(result.details === undefined
			? {}
			: { details: z.json().parse(result.details) }),
		...(message.nestedCalls === undefined
			? {}
			: {
					nestedCalls: {
						...message.nestedCalls,
						calls: message.nestedCalls.calls.map((call) => ({
							...call,
							...(call.arguments === undefined
								? {}
								: {
										arguments: z
											.record(z.string(), z.json())
											.parse(
												privateFeatureValue(
													call.arguments,
													[],
													protect,
												),
											),
									}),
							...(call.error === undefined
								? {}
								: { error: protect(call.error) }),
						})),
					},
				}),
	};
}
