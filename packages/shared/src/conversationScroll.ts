// 可変高さの会話を表示先が変わっても同じ行から読めるようにする通信契約。
import { isRecord } from "./validation";

/** スクロール量ではなく、画面上の行とその上端位置を基準に表示位置を表す。 */
export type ConversationScrollAnchor = {
	sessionId: string | null;
	entryKey: string | null;
	offset: number;
	atEnd: boolean;
};

/** Host へ渡す行 ID・位置・末尾かどうかを通信境界で検証する。 */
export function validConversationScrollAnchor(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}
	if (!(
		isRecord(value) &&
		(value.sessionId === null || typeof value.sessionId === "string")
	)) {
		return false;
	}
	if (!(
		(value.entryKey === null || typeof value.entryKey === "string") &&
		typeof value.offset === "number"
	)) {
		return false;
	}
	return Number.isFinite(value.offset) && typeof value.atEnd === "boolean";
}
