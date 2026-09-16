// postMessage の両端で型と値を検証し、不正な操作と壊れた状態を排除する。
import type { ChatState, HostMessage, UiMessage } from "./messages";
import { validComposerField } from "./composerValidation";
import { isAsyncTask } from "./asyncTask";
/** 配列・null を除いたオブジェクトを判定する。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 通信用の識別子を制限する。 */
function isId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}
/** UI からの要求を実行前に検証する。 */
export function isUiMessage(value: unknown): value is UiMessage {
	if (!isRecord(value)) {
		return false;
	}
	if (value.type === "ui/ready") {
		return true;
	}
	if (!isId(value.requestId)) {
		return false;
	}
	switch (value.type) {
		case "ui/openEditor":
		case "ui/openSidebar":
			return true;
		case "ui/saveDraft":
			return (
				typeof value.draft === "string" && value.draft.length <= 100_000
			);
		case "ui/saveScroll":
			return (
				typeof value.scrollTop === "number" &&
				Number.isFinite(value.scrollTop) &&
				value.scrollTop >= 0
			);
		case "connection/retry":
		case "session/new":
			return true;
		case "session/list":
			return (
				(value.archived === undefined ||
					typeof value.archived === "boolean") &&
				(value.more === undefined || typeof value.more === "boolean")
			);
		case "session/rename":
			return (
				isId(value.sessionId) &&
				typeof value.name === "string" &&
				value.name.trim().length > 0 &&
				value.name.length <= 200
			);
		case "session/unarchive":
			return isId(value.sessionId);
		case "session/load":
		case "session/fork":
		case "session/archive":
		case "session/delete":
			return isId(value.sessionId);
		case "auth/start":
			return isId(value.methodId);
		case "config/set":
			return (
				isId(value.sessionId) &&
				isId(value.configId) &&
				isId(value.value)
			);
		case "attachment/add":
			return isId(value.sessionId);
		case "attachment/open":
		case "attachment/remove":
			return isId(value.sessionId) && isId(value.attachmentId);
		case "prompt/send":
			return (
				isId(value.sessionId) &&
				typeof value.text === "string" &&
				value.text.trim().length > 0 &&
				value.text.length <= 100_000
			);
		case "prompt/cancel":
			return isId(value.sessionId) && isId(value.runId);
		case "permission/respond":
			return (
				isId(value.sessionId) &&
				isId(value.runId) &&
				isId(value.permissionId) &&
				isId(value.optionId)
			);
		case "execution/stop":
			return (
				isId(value.sessionId) && isId(value.runId) && isId(value.toolId)
			);
		default:
			return false;
	}
}
/** 配列の全項目に検証関数を適用する。 */
function every(
	value: unknown,
	test: (item: Record<string, unknown>) => boolean,
): boolean {
	return (
		Array.isArray(value) &&
		value.every((item: unknown) => isRecord(item) && test(item))
	);
}
/** 状態プロパティを項目ごとに検証する。 */
function validField(key: string, value: unknown): boolean {
	switch (key) {
		case "sessionTitle":
		case "cwd":
		case "sessionsError":
		case "sessionsNextCursor":
			return value === null || typeof value === "string";
		case "sessionsLoading":
		case "sessionsArchived":
		case "sessionPending":
			return typeof value === "boolean";
		case "sessionCapabilities":
			return (
				isRecord(value) &&
				["list", "load", "fork", "delete"].every(
					(key) => typeof value[key] === "boolean",
				) &&
				["rename", "unarchive", "archive"].every(
					(key) =>
						value[key] === undefined ||
						typeof value[key] === "boolean",
				)
			);
		case "sessions":
			return every(
				value,
				(item) =>
					isId(item.sessionId) &&
					(item.archived === undefined ||
						typeof item.archived === "boolean") &&
					typeof item.cwd === "string" &&
					(item.title === undefined ||
						typeof item.title === "string") &&
					(item.updatedAt === undefined ||
						typeof item.updatedAt === "string"),
			);
		case "asyncTasks":
			return Array.isArray(value) && value.every(isAsyncTask);
		case "connection":
			return [
				"disconnected",
				"connecting",
				"ready",
				"auth-required",
				"authenticating",
				"error",
			].includes(String(value));
		case "run":
			return [
				"idle",
				"running",
				"cancelling",
				"completed",
				"cancelled",
				"failed",
			].includes(String(value));
		case "sessionId":
		case "runId":
			return value === null || isId(value);
		case "error":
			return value === null || typeof value === "string";
		case "messages":
			return every(
				value,
				(item) =>
					isId(item.id) &&
					["user", "assistant"].includes(String(item.role)) &&
					typeof item.text === "string",
			);
		case "tools":
			return every(
				value,
				(item) =>
					isId(item.id) &&
					typeof item.title === "string" &&
					(item.kind === undefined ||
						typeof item.kind === "string") &&
					(item.content === undefined ||
						Array.isArray(item.content)) &&
					["pending", "in_progress", "completed", "failed"].includes(
						String(item.status),
					) &&
					Array.isArray(item.paths) &&
					item.paths.every((p: unknown) => typeof p === "string"),
			);
		case "permissions":
			return every(
				value,
				(item) =>
					isId(item.id) &&
					typeof item.title === "string" &&
					every(
						item.options,
						(o) =>
							isId(o.id) &&
							typeof o.name === "string" &&
							[
								"allow_once",
								"allow_always",
								"reject_once",
								"reject_always",
							].includes(String(o.kind)),
					),
			);
		case "authMethods":
			return every(
				value,
				(item) => isId(item.id) && typeof item.name === "string",
			);
		case "attachmentsSupported":
			return typeof value === "boolean";
		default:
			return validComposerField(key, value);
	}
}
/** 安全な単調増加番号を判定する。 */
function isRevision(value: unknown): boolean {
	return (
		Number.isSafeInteger(value) && typeof value === "number" && value >= 0
	);
}
/** 完全なスナップショットを検証する。 */
function isState(value: unknown): value is ChatState {
	return (
		isRecord(value) &&
		isRevision(value.revision) &&
		[
			"connection",
			"run",
			"sessionId",
			"sessionTitle",
			"runId",
			"error",
			"messages",
			"tools",
			"asyncTasks",
			"permissions",
			"authMethods",
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
		].every((key) => validField(key, value[key]))
	);
}
/** Host からの通知もブラウザで受信時に検証する。 */
export function isHostMessage(value: unknown): value is HostMessage {
	if (!isRecord(value)) {
		return false;
	}
	if (value.type === "ui/viewState") {
		return (
			typeof value.restoreScroll === "boolean" &&
			typeof value.editor === "boolean" &&
			typeof value.draft === "string" &&
			value.draft.length <= 100_000 &&
			typeof value.scrollTop === "number" &&
			Number.isFinite(value.scrollTop) &&
			value.scrollTop >= 0
		);
	}
	if (value.type === "state/snapshot") {
		return isState(value.state);
	}
	if (value.type === "request/failed") {
		return isId(value.requestId) && typeof value.error === "string";
	}
	return (
		value.type === "state/patch" &&
		isRevision(value.revision) &&
		isRecord(value.patch) &&
		Object.entries(value.patch).every(([key, item]) =>
			validField(key, item),
		)
	);
}
