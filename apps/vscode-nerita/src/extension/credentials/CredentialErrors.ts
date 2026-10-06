// 資格情報を含む可能性がある構文エラーの本文・スタック・cause を外部へ持ち出さない。
/** 例外の分類だけを残す。Provider 出力や不正な JSON の断片は含めない。 */
export function credentialErrorCause(error: unknown): Error {
	const category = error instanceof Error ? error.name : "CredentialError";
	return new Error("資格情報処理に失敗しました。", { cause: { category } });
}
/** 検証エラーには入力値が含まれ得るため、保護した原因だけを付けて中断する。 */
export function throwCredentialError(message: string, error: unknown): never {
	throw new Error(message, { cause: credentialErrorCause(error) });
}
