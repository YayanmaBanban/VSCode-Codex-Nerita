// 検索・コード実行の結果を伏字にし、承認の取消しを返答待ちから独立させる。
import { privateDisplayText } from "./results/PiDisplayText";

const sensitiveKey =
	/authorization|headers|cookie|password|secret|token|credential|api[_-]?key|private[_-]?key/i;

/** 結果・保存値・更新イベントのすべてに同じ保護を適用する。 */
export function privateFeatureValue<T>(
	value: T,
	secrets: readonly string[] = [],
	protect?: <TValue>(value: TValue) => TValue,
): T {
	const json: unknown = JSON.stringify(value);
	if (typeof json !== "string") {
		return value;
	}
	const encodedSecrets = secrets.flatMap((secret) => {
		const escaped = JSON.stringify(secret).slice(1, -1);
		return [secret, escaped, JSON.stringify(escaped).slice(1, -1)];
	});
	// JSON 全体の途中切断は構文を壊す。表示とコード実行の上限は各出力境界で適用する。
	const hidden = privateDisplayText(
		json,
		Number.POSITIVE_INFINITY,
		encodedSecrets,
	)
		.text.replace(/(?:Bearer\s+|sk-)[\w.-]+/g, "[非公開]")
		.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[非公開]");
	const result = JSON.parse(hidden, privateValue) as T;
	return protect?.(result) ?? result;
}

/** SDK が text に入れる JSON 文字列も、オブジェクトと同じ基準で伏字にする。 */
function privateValue(key: string, value: unknown): unknown {
	if (sensitiveKey.test(key)) {
		return "[非公開]";
	}
	if (typeof value !== "string" || !/^\s*[[{]/.test(value)) {
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
