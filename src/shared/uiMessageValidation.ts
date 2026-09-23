// Webviewから届く操作要求を、副作用を実行する前に検証する。
import type { UiMessage } from "./messages";
import { isBackendId } from "./backend";
import { isId, isRecord } from "./validation";
import { isSidebarLocation } from "./sidebar";
import { isPersonalityPreset } from "./personality";
import { validDroppedAttachments } from "./attachmentDrop";
import { validDraftParts } from "./composerContent";
import { validReferences } from "./composerReferences";
import { isPathString, isAbsoluteLocalPath } from "./workspacePaths";
import { isSourceRange } from "./symbolLocation";
import { isSymbolQuery } from "./workspaceSymbols";
import { validSessionIds } from "./sessionReferences";
import { isChangeScope, validChangeScopes } from "./changeReferences";
import { validCodeReferences } from "./codeReferences";

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

	const validator = uiMessageValidators.get(value.type);
	return validator ? validator(value) : false;
}

/** 各フィールドの検証を独立させ、未知のキーは受け付けない。 */
const uiMessageValidators = new Map<
	unknown,
	(value: Record<string, unknown>) => boolean
>(
	Object.entries({
		"ui/setBackend": (value) => isBackendId(value.backend),
		"agent/read": (value) => isId(value.sessionId) && isId(value.threadId),
		"changes/open": (value) => isChangeScope(value.scope),
		"session/searchReferences": (value) =>
			isSymbolQuery(value.query) &&
			(value.cursor === undefined || isPathString(value.cursor)),
		"session/openReference": (value) => isId(value.referencedSessionId),
		"reference/open": (value) =>
			isPathString(value.uri) &&
			(value.range === undefined || isSourceRange(value.range)),
		"workspace/searchSymbols": (value) => isSymbolQuery(value.query),
		"workspace/listPaths": (value) =>
			value.uri === null || isPathString(value.uri),
		"workspace/resolvePath": (value) =>
			isAbsoluteLocalPath(value.path) &&
			(value.range === undefined || isSourceRange(value.range)),
		"workspace/resolveCode": (value) =>
			typeof value.text === "string" &&
			value.text.trim().length > 0 &&
			value.text.length <= 100_000,
		"ui/setSidebar": (value) => isSidebarLocation(value.location),
		"personality/read": () => true,
		"personality/select": (value) =>
			(value.scope === "global" || value.scope === "workspace") &&
			typeof value.name === "string" &&
			value.name.length <= 200,
		"personality/save": (value) =>
			(value.scope === "global" || value.scope === "workspace") &&
			typeof value.originalName === "string" &&
			value.originalName.length <= 200 &&
			isPersonalityPreset(value),
		"ui/openEditor": () => true,
		"ui/openSidebar": () => true,
		"ui/saveDraft": (value) =>
			typeof value.draft === "string" &&
			value.draft.length <= 100_000 &&
			validDraftParts(value.draft, value.draftParts),
		"ui/saveScroll": (value) =>
			typeof value.scrollTop === "number" &&
			Number.isFinite(value.scrollTop) &&
			value.scrollTop >= 0,
		"connection/retry": () => true,
		"auth/logout": () => true,
		"session/new": () => true,
		"plan/decide": (value) =>
			isId(value.sessionId) &&
			isId(value.runId) &&
			["current", "new", "continue"].includes(String(value.action)),
		"session/list": (value) =>
			(value.archived === undefined ||
				typeof value.archived === "boolean") &&
			(value.more === undefined || typeof value.more === "boolean"),
		"session/rename": (value) =>
			isId(value.sessionId) &&
			typeof value.name === "string" &&
			value.name.trim().length > 0 &&
			value.name.length <= 200,
		"session/unarchive": (value) => isId(value.sessionId),
		"session/load": (value) => isId(value.sessionId),
		"session/fork": (value) => isId(value.sessionId),
		"session/archive": (value) => isId(value.sessionId),
		"session/delete": (value) => isId(value.sessionId),
		"auth/start": (value) => isId(value.methodId),
		"config/set": (value) =>
			isId(value.sessionId) && isId(value.configId) && isId(value.value),
		"attachment/add": (value) =>
			isId(value.sessionId) &&
			(value.files === undefined || validDroppedAttachments(value.files)),
		"attachment/open": (value) =>
			isId(value.sessionId) && isId(value.attachmentId),
		"attachment/remove": (value) =>
			isId(value.sessionId) && isId(value.attachmentId),
		"prompt/send": (value) =>
			isId(value.sessionId) &&
			typeof value.text === "string" &&
			value.text.trim().length > 0 &&
			value.text.length <= 100_000 &&
			validSessionIds(value.referencedSessionIds) &&
			validReferences(value.text, value.references) &&
			validChangeScopes(value.changeScopes) &&
			validCodeReferences(value.codeReferences),
		"prompt/cancel": (value) => isId(value.sessionId) && isId(value.runId),
		"permission/respond": (value) =>
			isId(value.sessionId) &&
			isId(value.runId) &&
			isId(value.permissionId) &&
			isId(value.optionId),
		"execution/stop": (value) =>
			isId(value.sessionId) && isId(value.runId) && isId(value.toolId),
	} satisfies Record<string, (value: Record<string, unknown>) => boolean>),
);
