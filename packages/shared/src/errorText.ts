// エラーを通信・表示用の文字列へ変換し、任意のオブジェクト全体を公開しない。
import { isRecord } from "./validation";

/** エラー種別の接頭詞を付けず、未知のオブジェクトも message だけを取り出す。 */
export function errorText(error: unknown): string {
	if (typeof error === "string") {
		return withoutErrorPrefix(error);
	}
	if (error instanceof Error) {
		const message = withoutErrorPrefix(error.message);
		return message.length > 0 ? message : "不明なエラー";
	}
	if (isRecord(error) && typeof error.message === "string") {
		return withoutErrorPrefix(error.message);
	}

	if (typeof error === "number") {
		return String(error);
	}
	if (typeof error === "boolean") {
		return String(error);
	}
	if (typeof error === "bigint") {
		return String(error);
	}
	if (typeof error === "symbol") {
		return String(error);
	}
	return "不明なエラー";
}

/** 外部から文字列で渡された場合も、先頭に付いた汎用の Error 接頭詞を除く。 */
function withoutErrorPrefix(message: string): string {
	return message.replace(/^(?:Error:\s*)+/, "");
}
