// ファイル操作の例外を未知の値として受け取り、復旧可能なエラーコードだけを取り出す。
import { isRecord } from "@nerita/shared/validation";

/** コードを持たない例外は分類せず、呼び出し側の再送出経路へ返す。 */
export function fsErrorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error.code === "string"
		? error.code
		: undefined;
}
