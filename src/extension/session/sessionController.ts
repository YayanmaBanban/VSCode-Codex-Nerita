// UI要求を会話へ振り分け、送信・停止・承認の排他制御を行う。
import type { UiMessage } from "../../shared/messages";
import { isUiMessage } from "../../shared/validation";
import { SessionRun } from "./sessionRun";
import { toolTerminalId } from "../../shared/toolTerminal";
/** 一つの会話に一つの実行だけを許可する。 */
export class SessionController extends SessionRun {
	private seen = new Set<string>();
	/** Webview入力を検証し、要求IDを一度だけ処理する。 */
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
			const first = this.seen.values().next().value;
			if (first) {
				this.seen.delete(first);
			}
		}
		try {
			await this.dispatch(value);
		} catch {
			this.emit({
				type: "request/failed",
				requestId: value.requestId,
				error:
					value.type === "terminal/kill"
						? "コマンドを停止できませんでした。実行状態を確認して再試行してください。"
						: "現在の状態では操作できません。接続状態を確認してください。",
			});
		}
	}
	/** 操作を現在のセッションに限定する。 */
	private async dispatch(
		message: Exclude<UiMessage, { type: "ui/ready" }>,
	): Promise<void> {
		if (message.type === "connection/retry") {
			if (
				["connecting", "authenticating"].includes(
					this.state.connection,
				) ||
				this.busy()
			) {
				throw new Error("Busy");
			}
			await this.connect();
			return;
		}
		if (message.type === "auth/start") {
			await this.authenticate(message.methodId);
			return;
		}
		if (message.type === "session/new") {
			if (this.busy() || this.state.connection !== "ready") {
				throw new Error("Busy");
			}
			await this.connect();
			return;
		}
		if (
			message.sessionId !== this.state.sessionId ||
			this.state.connection !== "ready"
		) {
			throw new Error("Stale session");
		}
		if (message.type === "prompt/send") {
			await this.prompt(message.text);
			return;
		}
		if (message.type === "config/set") {
			await this.setConfig(message.configId, message.value);
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
		if (message.type === "terminal/kill") {
			const tool = this.state.tools.find(
				(item) =>
					item.id === message.toolId && item.runId === message.runId,
			);
			// 現在実行中のカードが参照する端末以外への停止要求を拒否する。
			if (
				!this.transport ||
				!tool ||
				tool.kind !== "execute" ||
				!this.transport.terminalSnapshot(
					message.sessionId,
					message.terminalId,
				)?.canStop ||
				toolTerminalId(tool) !== message.terminalId
			) {
				throw new Error("Stale terminal");
			}
			await this.transport.killTerminal(
				message.sessionId,
				message.terminalId,
			);
			return;
		}
		if (message.runId !== this.state.runId || !this.busy()) {
			throw new Error("Stale run");
		}
		if (message.type === "prompt/cancel") {
			this.cancel();
			return;
		}
		if (
			this.state.run !== "running" ||
			!this.permissions.respond(message.permissionId, message.optionId)
		) {
			throw new Error("Stale permission");
		}
		this.patch({ permissions: this.permissions.list() });
	}
}
