// エラーを通信・表示用の文字列へ変換し、任意のオブジェクト全体を公開しない。
import { isRecord } from "./validation";

/** Error の名前と本文を保ち、未知のオブジェクトは message だけを取り出す。 */
export function errorText(error: unknown): string {
	if (typeof error === "string") {
		return error;
	}
	if (error instanceof Error) {
		return error.toString();
	}
	if (isRecord(error) && typeof error.message === "string") {
		return error.message;
	}
	if (
		typeof error === "number" ||
		typeof error === "boolean" ||
		typeof error === "bigint" ||
		typeof error === "symbol"
	) {
		return String(error);
	}
	return "不明なエラー";
}
