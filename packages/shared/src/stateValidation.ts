// 完全な状態復元では、差分通知と異なり全フィールドの存在を要求する。
import type { ChatState } from "./chatState";
import { isRecord, isRevision } from "./validation";
import { validStateField } from "./stateFieldValidation";

/** 完全なスナップショットを検証する。 */
export function isState(value: unknown): value is ChatState {
	return (
		isRecord(value) &&
		isRevision(value.revision) &&
		[
			"uiContributions",
			"personality",
			"skills",
			"connection",
			"run",
			"sessionId",
			"sessionTitle",
			"runId",
			"planDecision",
			"error",
			"messages",
			"tools",
			"agents",
			"asyncTasks",
			"permissions",
			"authMethods",
			"piAccount",
			"piProviderControls",
			"configOptions",
			"configPending",
			"usage",
			"quota",
			"attachments",
			"attachmentPending",
			"attachmentsSupported",
			"cwd",
			"sessions",
			"sessionCapabilities",
			"sessionsLoading",
			"sessionsArchived",
			"sessionsNextCursor",
			"sessionsError",
			"sessionPending",
		].every((key) => validStateField(key, value[key]))
	);
}
