// Host から届く通知を検証してから、Webview の状態や描画に反映する。
import type { HostMessage } from "./messages";
import { validConversationScrollAnchor } from "./conversationScroll";
import { validToolOutputResponse } from "./toolOutput";
import { isBackendId } from "./backend";
import { isId, isRecord, isRevision } from "./validation";
import { isState } from "./stateValidation";
import { validStateField } from "./stateFieldValidation";
import { isSidebarLocation } from "./sidebar";
import { validDraftParts } from "./composerContent";
import { isPathString, isWorkspacePath } from "./workspacePaths";
import { isSessionReference } from "./sessionReferences";
import { DlcEditorStateSchema, DlcViewSchema } from "./dlc/contracts";

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
		"dlc/state": (value) => DlcViewSchema.safeParse(value.view).success,
		"dlc/editorState": (value) =>
			DlcEditorStateSchema.safeParse(value.state).success,
		"workspace/trustState": (value) => typeof value.untrusted === "boolean",
		"tool/outputResult": validToolOutputResponse,
		"ui/codeBlock": (value) => {
			return isId(value.requestId);
		},
		"ui/backendState": (value) => {
			return isBackendId(value.backend);
		},
		"agent/view": validAgentViewReply,
		"agent/stopped": (value) =>
			isId(value.requestId) && isId(value.threadId),
		"session/references": validSessionReferencesReply,
		"workspace/symbols": validWorkspaceSymbolsReply,
		"workspace/paths": (value) => {
			if (!isId(value.requestId)) {
				return false;
			}
			if (!Array.isArray(value.entries)) {
				return false;
			}
			if (!value.entries.every(isWorkspacePath)) {
				return false;
			}
			return value.error === undefined || typeof value.error === "string";
		},
		"workspace/resolvedPath": (value) => {
			const matchesIsId5 =
				isId(value.requestId) &&
				(value.entry === null || isWorkspacePath(value.entry));
			return matchesIsId5;
		},
		"prompt/accepted": (value) => {
			const matchesIsId6 =
				isId(value.requestId) &&
				(value.mode === "start" || value.mode === "steer");
			return matchesIsId6;
		},
		"ui/sidebarState": (value) => {
			return isSidebarLocation(value.location);
		},
		"ui/viewState": validViewStateReply,
		"state/snapshot": (value) => {
			return isState(value.state);
		},
		"request/failed": (value) => {
			return isId(value.requestId) && typeof value.error === "string";
		},
		"state/patch": validStatePatchReply,
	} satisfies Record<string, (value: Record<string, unknown>) => boolean>),
);

/** 集約通知は適用元から最新までの前向きな範囲だけを許可する。 */
function validBaseRevision(base: unknown, revision: unknown): boolean {
	const matchesBase =
		base === undefined ||
		(isRevision(base) && Number(base) < Number(revision));
	return matchesBase;
}

/** 子の識別子と各会話フィールドを検証し、未検証の閲覧結果を UI へ渡さない。 */
function validAgentViewReply(value: Record<string, unknown>): boolean {
	const view = value.view;

	if (!isId(value.requestId)) {
		return false;
	}
	if (!isRecord(view)) {
		return false;
	}
	if (!isId(view.threadId)) {
		return false;
	}
	if (view.parentThreadId !== null && !isId(view.parentThreadId)) {
		return false;
	}
	return ["messages", "tools", "agents"].every((key) =>
		validStateField(key, view[key]),
	);
}

/** ページ件数・参照・カーソルを検証し、不正な一覧を参照候補として公開しない。 */
function validSessionReferencesReply(value: Record<string, unknown>): boolean {
	if (!isId(value.requestId)) {
		return false;
	}
	if (!Array.isArray(value.entries)) {
		return false;
	}
	if (!(value.entries.length <= 50)) {
		return false;
	}

	if (!value.entries.every(isSessionReference)) {
		return false;
	}
	if (!(value.nextCursor === null || isPathString(value.nextCursor))) {
		return false;
	}
	return value.error === undefined || typeof value.error === "string";
}

/** 件数とシンボル付きパスを検証し、通常パスをシンボル候補へ混ぜない。 */
function validWorkspaceSymbolsReply(value: Record<string, unknown>): boolean {
	if (!isId(value.requestId)) {
		return false;
	}
	if (!Array.isArray(value.entries)) {
		return false;
	}
	if (!(value.entries.length <= 100)) {
		return false;
	}

	if (!value.entries.every(isWorkspaceSymbol)) {
		return false;
	}
	if (!(typeof value.truncated === "boolean")) {
		return false;
	}
	return value.error === undefined || typeof value.error === "string";
}

/** 保存した編集と表示位置を復元前に検証し、本文と断片の不一致を拒否する。 */
function validViewStateReply(value: Record<string, unknown>): boolean {
	if (!(typeof value.restoreScroll === "boolean")) {
		return false;
	}
	if (!(typeof value.editor === "boolean")) {
		return false;
	}
	if (!(typeof value.draft === "string")) {
		return false;
	}

	if (!(value.draft.length <= 100_000)) {
		return false;
	}
	if (!validDraftParts(value.draft, value.draftParts)) {
		return false;
	}
	if (!(typeof value.scrollTop === "number")) {
		return false;
	}
	return (
		Number.isFinite(value.scrollTop) &&
		value.scrollTop >= 0 &&
		validConversationScrollAnchor(value.scrollAnchor)
	);
}

/** 順序番号と差分を検証し、同じ通知でツール配列の置換と差分更新を重ねない。 */
function validStatePatchReply(value: Record<string, unknown>): boolean {
	if (!(value.type === "state/patch")) {
		return false;
	}
	if (!isRevision(value.revision)) {
		return false;
	}
	if (!validBaseRevision(value.baseRevision, value.revision)) {
		return false;
	}

	const validToolUpdates =
		value.toolUpdates === undefined ||
		validStateField("tools", value.toolUpdates);
	if (!validToolUpdates) {
		return false;
	}
	if (!isRecord(value.patch)) {
		return false;
	}
	const overlappingToolUpdates =
		value.toolUpdates !== undefined && value.patch.tools !== undefined;
	if (overlappingToolUpdates) {
		return false;
	}
	return Object.entries(value.patch).every(([key, item]) =>
		validStateField(key, item),
	);
}

/** 通常パスではなくシンボルの座標を持つ候補だけをシンボル一覧へ渡す。 */
function isWorkspaceSymbol(entry: unknown): boolean {
	return isWorkspacePath(entry) && entry.symbol !== undefined;
}
