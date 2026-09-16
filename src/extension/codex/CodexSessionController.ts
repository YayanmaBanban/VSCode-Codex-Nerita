// 検証済みの Webview 操作を、現在の thread とローカル実行 ID に限定する。
import type { UiMessage } from "../../shared/messages";
import { isUiMessage } from "../../shared/validation";
import { CodexHistory } from "./CodexHistory";

/** 送信・停止・承認・接続・履歴操作を公開する。 */
export class CodexSessionController extends CodexHistory {
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
		} catch {
			this.emit({
				type: "request/failed",
				requestId: value.requestId,
				error: "現在の状態では操作できません。接続状態を確認してください。",
			});
		}
	}
	/** 操作範囲と実行状態を照合してから、対象の処理へ渡す。 */
	private async dispatch(
		message: Exclude<UiMessage, { type: "ui/ready" }>,
	): Promise<void> {
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
		if (message.type === "session/list") {
			await this.refreshSessions(message.archived, message.more);
			return;
		}
		if (
			message.type === "session/load" ||
			message.type === "session/fork" ||
			message.type === "session/delete" ||
			message.type === "session/rename" ||
			message.type === "session/unarchive"
		) {
			const action = message.type.slice("session/".length) as
				"load" | "fork" | "delete" | "rename" | "unarchive";
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
			await this.prompt(message.text);
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
