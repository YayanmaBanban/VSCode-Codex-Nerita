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
			const { cwd, sessionId } = this.state;
			const epoch = this.epoch;
			if (!cwd || !sessionId || this.state.connection !== "ready") {
				throw new Error("Disconnected");
			}
			await openChanges(
				cwd,
				message.scope,
				() =>
					epoch === this.epoch && sessionId === this.state.sessionId,
			);
			return;
		}
		if (
			message.type === "session/searchReferences" ||
			message.type === "session/openReference"
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
		if (
			message.type === "personality/read" ||
			message.type === "personality/save" ||
			message.type === "personality/select"
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
		if (this.state.sessionPending) {
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
		if (
			message.type === "session/load" ||
			message.type === "session/fork" ||
			message.type === "session/delete" ||
			message.type === "session/archive" ||
			message.type === "session/rename" ||
			message.type === "session/unarchive"
		) {
			const action = message.type.slice("session/".length) as
				"load" | "fork" | "delete" | "archive" | "rename" | "unarchive";
			await this.manageHistory(
				action,
				message.sessionId,
				message.type === "session/rename" ? message.name : undefined,
			);
			return;
		}
		if (
			!("sessionId" in message) ||
			message.sessionId !== this.state.sessionId
		) {
			throw new Error("Stale thread");
		}
		if (message.type === "prompt/send") {
			if (message.text.trim() === "/logout") {
				if (this.submissionPending) {
					throw new Error("Submission pending");
				}
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
				if (this.submissionPending) {
					throw new Error("Submission pending");
				}
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
		if (message.type === "config/set") {
			this.setConfig(message.configId, message.value);
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
