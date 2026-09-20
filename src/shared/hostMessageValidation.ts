// Hostから届く通知を、Webviewの状態や描画に反映する前に検証する。
import type { HostMessage } from "./messages";
import { isId, isRecord, isRevision } from "./validation";
import { isState } from "./stateValidation";
import { validStateField } from "./stateFieldValidation";
import { isSidebarLocation } from "./sidebar";
import { validDraftParts } from "./composerContent";
import { isPathString, isWorkspacePath } from "./workspacePaths";
import { isSessionReference } from "./sessionReferences";

/** Host からの通知もブラウザで受信時に検証する。 */
export function isHostMessage(value: unknown): value is HostMessage {
	if (!isRecord(value)) {
		return false;
	}
	if (value.type === "ui/codeBlock") {
		return isId(value.requestId);
	}
	if (value.type === "agent/view") {
		const view = value.view;
		return (
			isId(value.requestId) &&
			isRecord(view) &&
			isId(view.threadId) &&
			(view.parentThreadId === null || isId(view.parentThreadId)) &&
			["messages", "tools", "agents"].every((key) =>
				validStateField(key, view[key]),
			)
		);
	}
	if (value.type === "session/references") {
		return (
			isId(value.requestId) &&
			Array.isArray(value.entries) &&
			value.entries.length <= 50 &&
			value.entries.every(isSessionReference) &&
			(value.nextCursor === null || isPathString(value.nextCursor)) &&
			(value.error === undefined || typeof value.error === "string")
		);
	}
	if (value.type === "workspace/symbols") {
		return (
			isId(value.requestId) &&
			Array.isArray(value.entries) &&
			value.entries.length <= 100 &&
			value.entries.every(
				(entry: unknown) =>
					isWorkspacePath(entry) && entry.symbol !== undefined,
			) &&
			typeof value.truncated === "boolean" &&
			(value.error === undefined || typeof value.error === "string")
		);
	}
	if (value.type === "workspace/paths") {
		return (
			isId(value.requestId) &&
			Array.isArray(value.entries) &&
			value.entries.every(isWorkspacePath) &&
			(value.error === undefined || typeof value.error === "string")
		);
	}
	if (value.type === "workspace/resolvedPath") {
		return (
			isId(value.requestId) &&
			(value.entry === null || isWorkspacePath(value.entry))
		);
	}
	if (value.type === "prompt/accepted") {
		return (
			isId(value.requestId) &&
			(value.mode === "start" || value.mode === "steer")
		);
	}
	if (value.type === "ui/sidebarState") {
		return isSidebarLocation(value.location);
	}
	if (value.type === "ui/viewState") {
		return (
			typeof value.restoreScroll === "boolean" &&
			typeof value.editor === "boolean" &&
			typeof value.draft === "string" &&
			value.draft.length <= 100_000 &&
			validDraftParts(value.draft, value.draftParts) &&
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
			validStateField(key, item),
		)
	);
}
