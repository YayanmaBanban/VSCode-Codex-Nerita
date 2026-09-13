// UI要求を会話へ振り分け、送信・停止・承認の排他制御を行う。
import { randomUUID } from "node:crypto";
import type { UiMessage } from "../../shared/messages";
import { isRecord, isUiMessage } from "../../shared/validation";
import { SessionLifecycle } from "./sessionLifecycle";
/** 一つの会話に一つの実行だけを許可する。 */
export class SessionController extends SessionLifecycle {
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
				error: "現在の状態では操作できません。接続状態を確認してください。",
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
	/** 実行の完了と失敗を開始した接続にだけ反映する。 */
	private async prompt(text: string): Promise<void> {
		if (this.busy() || !this.transport || !this.state.sessionId) {
			throw new Error("Busy");
		}
		const transport = this.transport;
		const epoch = this.epoch;
		const runId = randomUUID();
		this.patch({
			run: "running",
			runId,
			error: null,
			tools: [],
			messages: [
				...this.state.messages,
				{ id: randomUUID(), role: "user", text },
			],
		});
		try {
			const result = await transport.prompt(this.state.sessionId, text);
			if (epoch !== this.epoch) {
				return;
			}
			const cancelled =
				this.state.run === "cancelling" ||
				result.stopReason === "cancelled";
			this.patch({ run: cancelled ? "cancelled" : "completed" });
			// ACP通知には実行IDがないため、停止後は接続を破棄して遅延通知の混入を防ぐ。
			if (cancelled) {
				this.disconnect();
				this.patch({
					connection: "disconnected",
					sessionId: null,
					permissions: [],
				});
			}
		} catch (error) {
			if (epoch === this.epoch) {
				if (this.state.run === "cancelling") {
					this.invalidate();
				} else {
					this.patch({
						run: "failed",
						error: "実行に失敗しました。入力内容を確認して再送するか、再接続してください。",
					});
					if (isRecord(error) && error.code === -32000) {
						this.connectionError(error);
					}
				}
			}
		} finally {
			if (epoch === this.epoch) {
				clearTimeout(this.cancelTimer);
				this.permissions.cancelAll();
				this.patch({ permissions: [] });
			}
		}
	}
	/** 停止待ち中は再送を防ぎ、応答しないプロセスも期限後に終了する。 */
	private cancel(): void {
		if (
			this.state.run !== "running" ||
			!this.transport ||
			!this.state.sessionId
		) {
			return;
		}
		this.permissions.cancelAll();
		this.patch({ run: "cancelling", permissions: [] });
		const epoch = this.epoch;
		void this.transport.cancel(this.state.sessionId).catch(() => {
			if (epoch === this.epoch) {
				this.failConnection();
			}
		});
		this.cancelTimer = setTimeout(() => {
			if (epoch === this.epoch) {
				this.invalidate();
			}
		}, 5000);
	}
}
