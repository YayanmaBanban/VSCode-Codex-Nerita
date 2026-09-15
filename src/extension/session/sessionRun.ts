// プロンプトの実行・停止・終了時の会話状態を管理する。
import { randomUUID } from "node:crypto";
import { isRecord } from "../../shared/validation";
import { SessionOptions } from "./sessionOptions";

/** 一つの実行の寿命を接続世代に限定する。 */
export class SessionRun extends SessionOptions {
	/** 実行の完了と失敗を開始した接続にだけ反映する。 */
	protected async prompt(text: string): Promise<void> {
		if (
			this.busy() ||
			this.state.configPending ||
			this.state.attachmentPending ||
			!this.transport ||
			!this.state.sessionId
		) {
			throw new Error("Busy");
		}
		const transport = this.transport;
		const epoch = this.epoch;
		const runId = randomUUID();
		const attachments = this.state.attachments;
		this.patch({
			run: "running",
			runId,
			error: null,
			attachments: [],
			messages: [
				...this.state.messages,
				{
					id: randomUUID(),
					role: "user",
					text,
					order: this.state.revision + 1,
				},
			],
		});
		try {
			const result = await transport.prompt(
				this.state.sessionId,
				text,
				attachments.map((file) => ({
					type: "resource_link",
					uri: file.uri,
					name: file.name,
				})),
			);
			if (epoch !== this.epoch) {
				return;
			}
			const cancelled =
				this.state.run === "cancelling" ||
				result.stopReason === "cancelled";
			// 停止完了はターンの終了。接続・セッション・履歴は次の送信にも使用する。
			this.patch({
				run: cancelled ? "cancelled" : "completed",
				permissions: [],
			});
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
				void this.refreshQuota();
			}
		}
	}
	/** 停止待ち中は再送を防ぎ、応答しないプロセスも期限後に終了する。 */
	protected cancel(): void {
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
