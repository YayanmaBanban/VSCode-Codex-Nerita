// 検索・コード実行の結果を伏字にし、承認の取消しを返答待ちから独立させる。
import { privateDisplayText } from "./results/PiDisplayText";
import { z } from "zod";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

const sensitiveKey =
	/authorization|headers|cookie|password|secret|token|credential|api[_-]?key|private[_-]?key/i;

/** 結果・保存値・更新イベントのすべてに同じ保護を適用する。 */
export function privateFeatureValue(
	value: unknown,
	secrets: readonly string[] = [],
	protect?: (value: string) => string,
) {
	const json: unknown = JSON.stringify(value);
	if (typeof json !== "string") {
		return undefined;
	}
	// キーや JSON 構文を文字列置換せず、値ごとに保護する。
	return z.json().parse(
		JSON.parse(json, (key: string, field: unknown) => {
			const result = sensitiveKey.test(key) ? "[非公開]" : field;
			return typeof result === "string"
				? privateFeatureText(result, secrets, protect)
				: result;
		}),
	);
}

/** 本文だけを置換し、文字列であることを保証する。 */
export function privateFeatureText(
	value: string,
	secrets: readonly string[] = [],
	protect?: (value: string) => string,
): string {
	const text = privateDisplayText(
		privateJsonText(value),
		Number.POSITIVE_INFINITY,
		secrets,
	)
		.text.replace(/(?:Bearer\s+|sk-)[\w.-]+/g, "[非公開]")
		.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[非公開]");
	return protect?.(text) ?? text;
}

/** SDK の判別子と制御フラグは保持し、任意データを元の型として返さない。 */
export function privateFeatureResult(
	result: AgentToolResult<unknown>,
	secrets: readonly string[] = [],
	protect?: (value: string) => string,
): AgentToolResult<unknown> {
	const structuredContent = privateFeatureValue(
		result.structuredContent,
		secrets,
		protect,
	);
	return {
		content: result.content.map((part) => {
			if (part.type === "text") {
				return {
					type: "text",
					text: privateFeatureText(part.text, secrets, protect),
				};
			}
			// 画像のデータや MIME が置換対象なら、破損した画像を返さず非公開の本文へ変える。
			if (
				privateFeatureText(part.data, secrets, protect) !== part.data ||
				privateFeatureText(part.mimeType, secrets, protect) !==
					part.mimeType
			) {
				return { type: "text", text: "[非公開]" };
			}
			return { type: "image", data: part.data, mimeType: part.mimeType };
		}),
		details: privateFeatureValue(result.details, secrets, protect),
		...(structuredContent === undefined ? {} : { structuredContent }),
		...(result.isError === undefined ? {} : { isError: result.isError }),
		...(result.terminate === undefined
			? {}
			: { terminate: result.terminate }),
		// 利用量は数値の SDK 契約であり、表示用の伏字変換から分離する。
		...(result.usage === undefined ? {} : { usage: result.usage }),
	};
}

/** SDK が text に入れる JSON 文字列も、オブジェクトと同じ基準で伏字にする。 */
function privateJsonText(value: string): string {
	if (!/^\s*[[{]/.test(value)) {
		return value;
	}
	try {
		return JSON.stringify(
			JSON.parse(value, (name: string, item: unknown) =>
				sensitiveKey.test(name) ? "[非公開]" : item,
			),
		);
	} catch {
		return value;
	}
}

/** UI の返答が遅れても、取消し後の承認で実行を再開させない。 */
export function abortableFeatureApproval<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) {
		return promise;
	}
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new Error("実行を停止しました。"),
			);
		};
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
		}
		void promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}
