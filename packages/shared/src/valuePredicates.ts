// 未設定・空文字・ゼロ・NaN を区別し、条件式と代替値の選択で同じ判定を使う。

/** 空文字は未入力として扱う。空白だけの文字列は呼び出し側で必要に応じて trim する。 */
export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

/** 空文字と未設定の場合だけ、代替値を選べる undefined に正規化する。 */
export function nonEmptyString(
	value: string | null | undefined,
): string | undefined {
	return isNonEmptyString(value) ? value : undefined;
}

/** 数値の真偽判定と同様、ゼロ・NaN・未設定を除外する。負数と無限大は許容する。 */
export function isNonZeroNumber(
	value: number | null | undefined,
): value is number {
	return typeof value === "number" && value !== 0 && !Number.isNaN(value);
}

/** ゼロ・NaN・未設定の場合だけ、代替値を選べる undefined に正規化する。 */
export function nonZeroNumber(
	value: number | null | undefined,
): number | undefined {
	return isNonZeroNumber(value) ? value : undefined;
}
