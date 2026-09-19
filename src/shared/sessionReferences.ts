// セッション参照の候補・チップ・読み取り要求をHostと共有する。
import { isPathString } from "./workspacePaths";

/** 会話を再開せず、送信時に本文を読み取るための参照。 */
export type SessionReference = {
	kind: "session";
	sessionId: string;
	name: string;
	cwd: string;
};

/** IDを本文やURLから推測せず、明示された参照として検証する。 */
export function isSessionReference(value: unknown): value is SessionReference {
	if (!value || typeof value !== "object") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		entry.kind === "session" &&
		typeof entry.sessionId === "string" &&
		entry.sessionId.length > 0 &&
		entry.sessionId.length <= 256 &&
		isPathString(entry.name) &&
		isPathString(entry.cwd)
	);
}

/** セッション参照の一ページ検索。検索語はタイトルに適用する。 */
export type SessionReferencesRequest = {
	type: "session/searchReferences";
	requestId: string;
	query: string;
	cursor?: string;
};

/** 履歴パネルの状態とは独立した候補ページ。 */
export type SessionReferencesResult = {
	type: "session/references";
	requestId: string;
	entries: SessionReference[];
	nextCursor: string | null;
	error?: string;
};

/** セッション本文をVS Codeで表示する要求。 */
export type SessionReferenceOpen = {
	type: "session/openReference";
	requestId: string;
	referencedSessionId: string;
};

/** 一送信で参照できるセッション数を制限する。 */
export function validSessionIds(value: unknown): value is string[] | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) &&
			value.length <= 5 &&
			value.every(
				(id: unknown) =>
					typeof id === "string" && id.length > 0 && id.length <= 256,
			))
	);
}
