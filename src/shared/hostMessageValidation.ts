// Hostから届く通知を、Webviewの状態や描画に反映する前に検証する。
import type { HostMessage } from "./messages";
import { isBackendId } from "./backend";
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
	const validator = hostMessageValidators.get(value.type);
	return validator ? validator(value) : false;
}

/** 通知の種類ごとにペイロードを検証し、未知の種類を拒否する。 */
const hostMessageValidators = new Map<
	unknown,
	(value: Record<string, unknown>) => boolean
>(
	Object.entries({
		"ui/codeBlock": (value) => {
			return isId(value.requestId);
		},
		"ui/backendState": (value) => {
			return isBackendId(value.backend);
		},
		"agent/view": (value) => {
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
		},
		"session/references": (value) => {
			return (
				isId(value.requestId) &&
				Array.isArray(value.entries) &&
				value.entries.length <= 50 &&
				value.entries.every(isSessionReference) &&
				(value.nextCursor === null || isPathString(value.nextCursor)) &&
				(value.error === undefined || typeof value.error === "string")
			);
		},
		"workspace/symbols": (value) => {
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
		},
		"workspace/paths": (value) => {
			return (
				isId(value.requestId) &&
				Array.isArray(value.entries) &&
				value.entries.every(isWorkspacePath) &&
				(value.error === undefined || typeof value.error === "string")
			);
		},
		"workspace/resolvedPath": (value) => {
			return (
				isId(value.requestId) &&
				(value.entry === null || isWorkspacePath(value.entry))
			);
		},
		"prompt/accepted": (value) => {
			return (
				isId(value.requestId) &&
				(value.mode === "start" || value.mode === "steer")
			);
		},
		"ui/sidebarState": (value) => {
			return isSidebarLocation(value.location);
		},
		"ui/viewState": (value) => {
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
		},
		"state/snapshot": (value) => {
			return isState(value.state);
		},
		"request/failed": (value) => {
			return isId(value.requestId) && typeof value.error === "string";
		},
		"state/patch": (value) =>
			value.type === "state/patch" &&
			isRevision(value.revision) &&
			isRecord(value.patch) &&
			Object.entries(value.patch).every(([key, item]) =>
				validStateField(key, item),
			),
	} satisfies Record<string, (value: Record<string, unknown>) => boolean>),
);
