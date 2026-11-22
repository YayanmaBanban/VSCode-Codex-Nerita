// チャット状態の公開項目だけを抽出し、モバイル向けの上限を適用する。
import type { ChatState, Permission } from "@nerita/shared/chatState";
import {
	remoteStateBytes,
	remoteTextLimit,
	type RemoteChatState,
} from "@nerita/shared/remote/contracts";
import type { BackendSelection } from "../backends/BackendSelection";
import { sessionWriting } from "../session/DirectoryRuns";

const approvalTitles = new Set([
	"ファイル変更の承認",
	"端末への入力の承認",
	"コマンド実行の承認",
	"ネットワーク接続の承認",
	"個人情報を含む入力を今回だけ送信",
	"Pi: bash の実行承認",
	"Pi: read の実行承認",
	"Pi: ls の実行承認",
	"Pi: write の実行承認",
	"Pi: edit の実行承認",
]);

/** Approvals が確実に単発と定義する ID と効果の組だけを公開する。 */
export function remoteApproval(permission: Permission) {
	const known = approvalTitles.has(permission.title);
	const options: RemoteChatState["pendingApprovals"][number]["options"] = [];
	for (const option of permission.options) {
		if (known && option.id === "accept" && option.kind === "allow") {
			options.push({ id: option.id, kind: option.kind });
		}
		if (option.id === "decline" && option.kind === "deny") {
			options.push({ id: option.id, kind: option.kind });
		}
	}
	return {
		id: permission.id,
		title: known ? permission.title : "PCで詳細を確認する承認",
		options,
	};
}

/** 準備中の会話や、PC で添付を編集中の会話への送信を防ぐ。 */
export function canSendRemote(state: ChatState): boolean {
	const pending =
		state.configPending || state.sessionPending || state.attachmentPending;
	const needsReview =
		state.permissions.length > 0 ||
		state.questions.length > 0 ||
		state.planDecision !== null;
	const blocked = pending || needsReview || state.attachments.length > 0;
	return state.connection === "ready" && !sessionWriting(state) && !blocked;
}

/** UTF-8 のバイト数で本文を切り詰める。 */
function limitText(value: string): string {
	if (Buffer.byteLength(value) <= remoteTextLimit) {
		return value;
	}
	// UTF-8 の途中で分割せず、末尾の不完全な文字だけを除く。
	const bytes = Buffer.from(value);
	let end = remoteTextLimit;
	while ((bytes[end]! & 0xc0) === 0x80) {
		end--;
	}
	return bytes.toString("utf8", 0, end);
}

/** Host の生データをコピーせず、公開項目だけで全量スナップショットを作る。 */
export function projectRemoteState(
	state: ChatState,
	selection: BackendSelection,
	connectionGeneration: string,
	workspaceTrusted: boolean,
): RemoteChatState {
	const { backend, generation, switching } = selection.current();
	const selectable = !selection.busy(state);
	const messages = state.messages
		.slice(-50)
		.map(({ id, role, text, streaming }) => ({
			id,
			role,
			text: limitText(text),
			streaming: streaming ?? false,
		}));
	const trusted = workspaceTrusted && !switching;
	const approvals = state.permissions.slice(-20).map(remoteApproval);
	const result: RemoteChatState = {
		backend,
		backendGeneration: generation,
		connectionGeneration,
		availableBackends: [
			{ id: "pi", selectable },
			{ id: "codex", selectable },
		],
		switching,
		sessionId: state.sessionId,
		sessionTitle: state.sessionTitle?.slice(0, 256) ?? null,
		revision: state.revision,
		connection: state.connection,
		runId: state.runId,
		run: state.run,
		messages,
		tools: state.tools
			.slice(-30)
			.map(({ id, status }) => ({ id, status, title: "ツール実行" })),
		pendingApprovals: approvals,
		error: backendError(state, backend),
		capabilities: capabilities(state, trusted, switching),
		truncated: omittedContent(state, messages),
		sessions: trusted ? sessionHistory(state) : [],
		canManageSessions:
			trusted && selectable && state.connection === "ready",
	};
	enforceBudget(result);
	return result;
}

/** PC と同じ作業ルートの通常履歴だけを公開し、絶対パスを除く。 */
function sessionHistory(state: ChatState): RemoteChatState["sessions"] {
	return state.sessions
		.filter((entry) => entry.cwd === state.cwd && entry.archived !== true)
		.slice(0, 30)
		.map((entry) => ({
			id: entry.sessionId,
			title: entry.title?.slice(0, 256) ?? "タイトルなし",
			...(entry.updatedAt === undefined
				? {}
				: { updatedAt: entry.updatedAt }),
		}));
}

/** 接続失敗をバックエンド名で区別し、元のエラー本文を公開しない。 */
function backendError(
	state: ChatState,
	backend: RemoteChatState["backend"],
): RemoteChatState["error"] {
	if (state.connection === "error") {
		return backend === "pi" ? "pi-unavailable" : "codex-unavailable";
	}
	return state.run === "failed" ? "run-failed" : null;
}

/** 現在の状態から表示上の操作可否を導出する。実行時にも Host で再確認する。 */
function capabilities(
	state: ChatState,
	trusted: boolean,
	switching: boolean,
): RemoteChatState["capabilities"] {
	const hasRun = state.runId !== null;
	return {
		send: trusted && canSendRemote(state),
		stop: !switching && hasRun && sessionWriting(state),
		approve: trusted && hasRun && state.connection === "ready",
	};
}

/** 件数やバイト上限で表示範囲が縮んだことを明示する。 */
function omittedContent(
	state: ChatState,
	messages: RemoteChatState["messages"],
): boolean {
	const omittedItems =
		state.messages.length > 50 ||
		state.tools.length > 30 ||
		state.permissions.length > 20;
	return (
		omittedItems ||
		messages.some(
			({ text }, i) =>
				text !== state.messages.at(i - messages.length)?.text,
		)
	);
}

/** 最新の会話を残しながら、エンコード済み JSON を上限に収める。 */
function enforceBudget(result: RemoteChatState): void {
	const { messages } = result;
	let bytes = Buffer.byteLength(JSON.stringify(result));
	while (bytes > remoteStateBytes && messages.length > 0) {
		bytes -= Buffer.byteLength(JSON.stringify(messages.shift())) + 1;
		result.truncated = true;
	}
}
