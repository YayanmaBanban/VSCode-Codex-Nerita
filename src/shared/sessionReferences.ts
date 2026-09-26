// セッション参照の候補・チップ・読み取り要求を Host と共有する。
import { isPathString } from "./workspacePaths";

/** 会話を再開せず、送信時に本文を読み取るための参照。 */
export type SessionReference = {
	kind: "session";
	mode: SessionReferenceMode;
	sessionId: string;
	name: string;
	cwd: string;
};

/** ID を本文や URL から推測せず、明示された参照として検証する。 */
export function isSessionReference(value: unknown): value is SessionReference {
	if (!value || typeof value !== "object") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		entry.kind === "session" &&
		isSessionReferenceMode(entry.mode) &&
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

/** セッション本文を VS Code で表示する要求。 */
export type SessionReferenceOpen = {
	type: "session/openReference";
	requestId: string;
	referencedSessionId: string;
};

/** 原文参照と作業引き継ぎを区別する。 */
export type SessionReferenceMode = "transcript" | "handoff";
/** 送信時は表示名や作業場所を信用せず、ID から履歴を読み直す。 */
export type SessionContextReference = Pick<
	SessionReference,
	"sessionId" | "mode"
>;

/** 原文参照と作業引き継ぎを通信境界で区別する。 */
export function isSessionReferenceMode(
	value: unknown,
): value is SessionReferenceMode {
	return value === "transcript" || value === "handoff";
}

/** 同じ会話でも参照方法が違えば別件として数える。 */
export function validSessionReferences(
	value: unknown,
): value is SessionContextReference[] | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) &&
			value.length <= 5 &&
			value.every((item: unknown) => {
				if (!item || typeof item !== "object") {
					return false;
				}
				const entry = item as Record<string, unknown>;
				return (
					isSessionReferenceMode(entry.mode) &&
					typeof entry.sessionId === "string" &&
					entry.sessionId.length > 0 &&
					entry.sessionId.length <= 256
				);
			}))
	);
}
