// Webview とリモートの履歴パネルが読む状態を定義する。
import type { ChatState } from "@nerita/shared/chatState";

/** 復元完了は sessionPending と sessionId の両方で確認する。 */
export type SessionPanelState = Pick<
	ChatState,
	| "cwd"
	| "connection"
	| "sessionId"
	| "sessionCapabilities"
	| "sessionPending"
	| "configPending"
	| "attachmentPending"
	| "run"
	| "asyncTasks"
	| "error"
	| "sessions"
	| "sessionsLoading"
	| "sessionsError"
	| "sessionsArchived"
	| "sessionsNextCursor"
>;
