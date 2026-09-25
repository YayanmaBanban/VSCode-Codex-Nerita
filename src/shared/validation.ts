// 通信内容に依存しない基本検証をまとめ、機能別の検証から循環参照させない。

/** 配列・null を除いたオブジェクトを判定する。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 通信用の識別子を制限する。 */
export function isId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** 項目を検証する前に、配列や `null` がレコードとして扱われることを防ぐ。 */
export function everyRecord(
	value: unknown,
	test: (item: Record<string, unknown>) => boolean,
): boolean {
	return (
		Array.isArray(value) &&
		value.every((item: unknown) => isRecord(item) && test(item))
	);
}

/** 通信値の範囲だけを検証し、新旧の比較は受信側の状態管理に委ねる。 */
export function isRevision(value: unknown): boolean {
	return (
		Number.isSafeInteger(value) && typeof value === "number" && value >= 0
	);
}
