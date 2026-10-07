// 通知と履歴が検証した項目の識別子を、内部の利用側まで型として保持する。
import { isRecord } from "@nerita/shared/validation";

/** 種別固有の本文は各正規化処理が検証し、未知の項目の診断情報も保持する。 */
export type CodexItem = Record<string, unknown> & { id: string; type: string };

/** 識別子を持たない項目は通知・履歴の入口で拒否する。 */
export function parseCodexItem(value: unknown): CodexItem {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.type !== "string"
	) {
		throw new Error("Invalid item identity");
	}
	return { ...value, id: value.id, type: value.type };
}
