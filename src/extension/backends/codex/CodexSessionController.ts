// 検証済みの Webview 操作を、現在の thread とローカル実行 ID に限定する。
import type { UiMessage } from "../../../shared/messages";
import { isUiMessage } from "../../../shared/uiMessageValidation";
import { CodexSubmission } from "./CodexSubmission";
import {
	searchSessionReferences,
	openSessionReference,
} from "./context/sessionReferenceActions";
import { SessionContextError } from "./context/sessionContext";
import { ChangeContextError } from "./context/changeContext";
import { openChanges } from "./context/openChanges";
import { CodeReferenceError } from "../../session/codeReferenceContext";

import {
	type SessionReferencesRequest,
	type SessionReferenceOpen,
} from "@/shared/sessionReferences";

/** 送信・停止・承認・接続・履歴操作を公開する。 */
export class CodexSessionController extends CodexSubmission {
	private seen = new Set<string>();
	/** 二重要求と古い UI の操作を排除して、失敗は要求元へ通知する。 */
	async receive(value: unknown): Promise<void> {
		if (!isUiMessage(value)) {
			return;
		}
		if (value.type === "ui/ready") {
			this.emit({ type: "state/snapshot", state: this.snapshot() });
			return;
		}
		if (this.seen.has(value.requestId)) {
			return;
		}
		this.seen.add(value.requestId);
		if (this.seen.size > 2048) {
			this.seen.delete(this.seen.values().next().value!);
		}
		try {
			await this.dispatch(value);
		} catch (error) {
			this.emit({
				type: "request/failed",
				requestId: value.requestId,
				error: requestError(value.type, error),
			});
		}
	}
	/** 操作範囲と実行状態を照合してから、対象の処理へ渡す。 */
	private async dispatch(
		message: Exclude<UiMessage, { type: "ui/ready" }>,
	): Promise<void> {
		if (message.type === "agent/read") {
			await this.readAgent(message);
			return;
		}
		if (message.type === "changes/open") {
			return await this.openRequestedChanges(message);
		}
		if (
			message.type === "session/searchReferences" ||
			message.type === "session/openReference"
		) {
			return await this.sessionReferenceAction(message);
		}
		if (
			message.type === "personality/read" ||
			message.type === "personality/save" ||
			message.type === "personality/select"
		) {
			return await this.personalityAction(message);
		}
		await this.dispatchMutableAction(message);
	}

	/** 更新待ちを排除して認証・接続操作を処理する。 */
	private async dispatchMutableAction(message: UiMessage): Promise<void> {
		if (
			this.submissionPending &&
			![
				"prompt/send",
				"prompt/cancel",
				"execution/stop",
				"permission/respond",
			].includes(message.type)
		) {
			throw new Error("Submission pending");
		}
		if (this.state.sessionPending || this.state.configPending) {
			throw new Error("Session pending");
		}
		if (message.type === "connection/retry") {
			if (this.busy() || this.state.connection === "connecting") {
				throw new Error("Busy");
			}
			await this.connect();
			return;
		}
		if (message.type === "auth/start") {
			await this.authenticate(message.methodId);
			return;
		}
		if (this.state.connection !== "ready") {
			throw new Error("Disconnected");
		}
		await this.dispatchReadyAction(message);
	}

	/** 接続済みの会話操作と履歴操作を振り分ける。 */
	private async dispatchReadyAction(message: UiMessage): Promise<void> {
		if (message.type === "plan/decide") {
			await this.decidePlan(message);
			return;
		}
		if (message.type === "session/new") {
			await this.newThread();
			return;
		}
		if (message.type === "auth/logout") {
			await this.logout();
			return;
		}
		if (message.type === "session/list") {
			await this.refreshSessions(message.archived, message.more);
			return;
		}
		if (isHistoryAction(message)) {
			const action = message.type.slice("session/".length) as
				"load" | "fork" | "delete" | "archive" | "rename" | "unarchive";
			await this.manageHistory(
				action,
				message.sessionId,
				message.type === "session/rename" ? message.name : undefined,
			);
			return;
		}
		await this.dispatchThreadAction(message);
	}

	/** 表示中の Plan だけを対象に、モード変更から送信までを処理する。 */
	private async decidePlan(
		message: Extract<UiMessage, { type: "plan/decide" }>,
	) {
		const decision = this.state.planDecision;
		if (
			!decision ||
			message.sessionId !== this.state.sessionId ||
			message.runId !== decision.runId ||
			this.busy()
		) {
			throw new Error("Stale plan");
		}
		if (message.action === "continue") {
			this.patch({ planDecision: null });
			return;
		}
		const plan = decision.text;
		if (message.action === "new") {
			const settings = this.capturePlanSettings();
			await this.newThread();
			await this.restorePlanSettings(settings);
		} else {
			await this.setConfig("collaboration_mode", "default");
		}
		this.patch({ planDecision: null });
		const text =
			message.action === "new"
				? `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\n${plan}`
				: plan;
		await this.submitPrompt(text, this.state.sessionId);
	}

	/** 操作対象が現在の会話であることを確認する。 */
	private async dispatchThreadAction(message: UiMessage): Promise<void> {
		if (
			!("sessionId" in message) ||
			message.sessionId !== this.state.sessionId
		) {
			throw new Error("Stale thread");
		}
		if (message.type === "prompt/send") {
			return this.sendPromptAction(message);
		}
		if (message.type === "config/set") {
			await this.setConfig(message.configId, message.value);
			await this.rememberSelection(message.configId);
			return;
		}
		if (
			message.type === "attachment/add" ||
			message.type === "attachment/open" ||
			message.type === "attachment/remove"
		) {
			await this.attachment(message);
			return;
		}
		this.runningAction(message);
	}

	/** 接続中の性格設定を読み取りまたは変更する。 */
	private async personalityAction(
		message: Extract<
			UiMessage,
			{
				type:
					| "personality/read"
					| "personality/select"
					| "personality/save";
			}
		>,
	) {
		const client = this.client;
		const epoch = this.epoch;
		if (!client?.readPersonality || !client.changePersonality) {
			throw new Error("接続後に設定を開いてください。");
		}
		const personality =
			message.type === "personality/read"
				? await client.readPersonality()
				: await client.changePersonality(message);
		if (epoch === this.epoch) {
			this.patch({ personality });
		}
		return;
	}

	/** 参照候補の検索と会話表示を同じ接続世代で実行する。 */
	private async sessionReferenceAction(
		message: SessionReferencesRequest | SessionReferenceOpen,
	) {
		const client = this.client;
		const cwd = this.state.cwd;
		const id = this.state.sessionId;
		const epoch = this.epoch;
		if (!client || !cwd || !id || this.state.connection !== "ready") {
			throw new Error("Disconnected");
		}
		const current = () =>
			epoch === this.epoch && id === this.state.sessionId;
		if (message.type === "session/searchReferences") {
			const result = await searchSessionReferences(
				client,
				cwd,
				id,
				message,
				current,
			);
			if (current()) {
				this.emit(result);
			}
		} else {
			await openSessionReference(client, cwd, message, current);
		}
		return;
	}

	/** 現在の接続と会話に限定して差分を開く。 */
	private async openRequestedChanges(
		message: Extract<UiMessage, { type: "changes/open" }>,
	) {
		const { cwd, sessionId } = this.state;
		const epoch = this.epoch;
		if (!cwd || !sessionId || this.state.connection !== "ready") {
			throw new Error("Disconnected");
		}
		await openChanges(
			cwd,
			message.scope,
			() => epoch === this.epoch && sessionId === this.state.sessionId,
		);
		return;
	}

	/** 入力欄のコマンドと通常送信を処理する。 */
	private async sendPromptAction(
		message: Extract<UiMessage, { type: "prompt/send" }>,
	): Promise<void> {
		const command = /^\/(plan|goal)(?:\s+([\s\S]*))?$/u.exec(
			message.text.trim(),
		);
		if (command) {
			this.assertSubmissionIdle();
			if (this.collaborationMode !== command[1]) {
				await this.setConfig("collaboration_mode", command[1]!);
			}
			if (!command[2]?.trim()) {
				this.emit({
					type: "prompt/accepted",
					requestId: message.requestId,
					mode: "start",
				});
				return;
			}
			// /plan 自体はモデルへの指示にせず、本文だけで計画ターンを開始する。
			if (command[1] === "plan") {
				message = { ...message, text: command[2] };
			}
		}
		if (message.text.trim() === "/logout") {
			this.assertSubmissionIdle();
			await this.logout();
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		if (message.text.trim() === "/mcp") {
			await this.showMcpStatus(message.sessionId);
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		if (message.text.trim() === "/new") {
			this.assertSubmissionIdle();
			await this.newThread();
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		const mode = await this.submitPrompt(
			message.text,
			message.sessionId,
			message.referencedSessionIds,
			message.changeScopes,
			message.codeReferences,
			message.references,
		);
		this.emit({
			type: "prompt/accepted",
			requestId: message.requestId,
			mode,
		});
		return;
	}

	/** 送信準備中の会話切り替えを禁止する。 */
	private assertSubmissionIdle() {
		if (this.submissionPending) {
			throw new Error("Submission pending");
		}
	}

	/** 現在の実行に対する停止と承認操作を処理する。 */
	private runningAction(message: UiMessage): void {
		if (
			!("runId" in message) ||
			message.runId !== this.state.runId ||
			!this.busy()
		) {
			throw new Error("Stale run");
		}
		if (message.type === "prompt/cancel") {
			this.cancel();
			return;
		}
		if (message.type === "execution/stop") {
			this.assertCurrentTool(message);
			this.cancel();
			return;
		}
		if (
			message.type === "permission/respond" &&
			this.state.run === "running" &&
			this.approvals.respond(message.permissionId, message.optionId)
		) {
			if (message.optionId === "cancel") {
				this.cancel();
			}
			return;
		}
		throw new Error("Unsupported action");
	}

	/** 停止要求のツールが現在の実行に含まれるか照合する。 */
	private assertCurrentTool(
		message: Extract<UiMessage, { type: "execution/stop" }>,
	) {
		if (
			!this.state.tools.some(
				(tool) =>
					tool.id === message.toolId &&
					tool.runId === message.runId &&
					["pending", "in_progress"].includes(tool.status),
			)
		) {
			throw new Error("Stale tool");
		}
	}
}

/** 参照の詳細エラーを優先し、操作に応じた復旧方法を返す。 */
function requestError(type: UiMessage["type"], error: unknown) {
	if (
		error instanceof SessionContextError ||
		error instanceof ChangeContextError ||
		error instanceof CodeReferenceError
	) {
		return error.message;
	}
	if (type.startsWith("personality/") && error instanceof Error) {
		return `性格設定を読み込み・保存できませんでした: ${error.message}`;
	}
	if (type === "prompt/send") {
		return "送信できませんでした。接続を確認して再試行してください。";
	}
	return "現在の状態では操作できません。接続状態を確認してください。";
}

/** 会話 ID を指定して保存履歴を変更する操作を識別する。 */
function isHistoryAction(message: UiMessage): message is Extract<
	UiMessage,
	{
		type:
			| "session/load"
			| "session/fork"
			| "session/delete"
			| "session/archive"
			| "session/rename"
			| "session/unarchive";
	}
> {
	return [
		"session/load",
		"session/fork",
		"session/delete",
		"session/archive",
		"session/rename",
		"session/unarchive",
	].includes(message.type);
}
