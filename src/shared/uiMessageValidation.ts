// Webviewから届く操作要求を、副作用を実行する前に検証する。
import type { UiMessage } from "./messages";
import { isId, isRecord } from "./validation";
import { isSidebarLocation } from "./sidebar";
import { isPersonalityPreset } from "./personality";
import { validDroppedAttachments } from "./attachmentDrop";
import { validDraftParts } from "./composerContent";
import { isPathString, isAbsoluteLocalPath } from "./workspacePaths";
import { isSourceRange } from "./symbolLocation";
import { isSymbolQuery } from "./workspaceSymbols";
import { validSessionIds } from "./sessionReferences";
import { isChangeScope, validChangeScopes } from "./changeReferences";

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
		case "agent/read":
			return isId(value.sessionId) && isId(value.threadId);
		case "changes/open":
			return isChangeScope(value.scope);
		case "session/searchReferences":
			return (
				isSymbolQuery(value.query) &&
				(value.cursor === undefined || isPathString(value.cursor))
			);
		case "session/openReference":
			return isId(value.referencedSessionId);
		case "reference/open":
			return (
				isPathString(value.uri) &&
				(value.range === undefined || isSourceRange(value.range))
			);
		case "workspace/searchSymbols":
			return isSymbolQuery(value.query);
		case "workspace/listPaths":
			return value.uri === null || isPathString(value.uri);
		case "workspace/resolvePath":
			return isAbsoluteLocalPath(value.path);
		case "ui/setSidebar":
			return isSidebarLocation(value.location);
		case "personality/read":
			return true;
		case "personality/select":
			return (
				(value.scope === "global" || value.scope === "workspace") &&
				typeof value.name === "string" &&
				value.name.length <= 200
			);
		case "personality/save":
			return (
				(value.scope === "global" || value.scope === "workspace") &&
				typeof value.originalName === "string" &&
				value.originalName.length <= 200 &&
				isPersonalityPreset(value)
			);
		case "ui/openEditor":
		case "ui/openSidebar":
			return true;
		case "ui/saveDraft":
			return (
				typeof value.draft === "string" &&
				value.draft.length <= 100_000 &&
				validDraftParts(value.draft, value.draftParts)
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
			return (
				isId(value.sessionId) &&
				(value.files === undefined ||
					validDroppedAttachments(value.files))
			);
		case "attachment/open":
		case "attachment/remove":
			return isId(value.sessionId) && isId(value.attachmentId);
		case "prompt/send":
			return (
				isId(value.sessionId) &&
				typeof value.text === "string" &&
				value.text.trim().length > 0 &&
				value.text.length <= 100_000 &&
				validSessionIds(value.referencedSessionIds) &&
				validChangeScopes(value.changeScopes)
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
