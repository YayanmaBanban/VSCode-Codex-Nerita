// 検証済みWebviewメッセージをPiの最小機能へ接続する。
import type { BackendSession } from "../../session/chatSession";
import { isUiMessage } from "../../../shared/uiMessageValidation";
import type { UiMessage } from "../../../shared/messages";
import { PiHistory } from "./PiHistory";

/** Codexと同じ通信境界で送信・停止・再接続・新規会話を公開する。 */
export class PiSessionController extends PiHistory implements BackendSession {
	private seen = new Set<string>();

	/** 重複・不正要求を無視し、未対応操作は要求元に明示する。 */
	async receive(value: unknown): Promise<void> {
		if (this.disposed || !isUiMessage(value)) {
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
				error:
					error instanceof Error
						? error.message
						: "Piで操作できませんでした。",
			});
		}
	}

	/** 会話IDと実行IDを確認し、古い画面からのStopを拒否する。 */
	private async dispatch(
		message: Exclude<UiMessage, { type: "ui/ready" }>,
	): Promise<void> {
		if (message.type === "connection/retry") {
			await this.connect();
			return;
		}
		if (this.state.connection !== "ready") {
			throw new Error("Piへ再接続してから操作してください。");
		}
		if (message.type === "session/new") {
			await this.connect();
			return;
		}
		if (message.type === "session/list") {
			if (message.archived || message.more) {
				throw new Error("Piのアーカイブ・追加ページは未対応です。");
			}
			await this.refreshSessions();
			return;
		}
		if (message.type === "session/load") {
			await this.loadSession(message.sessionId);
			return;
		}
		if (
			!("sessionId" in message) ||
			message.sessionId !== this.state.sessionId
		) {
			throw new Error("現在のPi会話では実行できない操作です。");
		}
		if (message.type === "prompt/send") {
			this.submit(message);
			return;
		}
		if (
			message.type === "permission/respond" &&
			message.runId === this.state.runId &&
			this.state.run === "running" &&
			this.approvals.respond(message.permissionId, message.optionId)
		) {
			return;
		}
		if (
			message.type === "prompt/cancel" &&
			message.runId === this.state.runId &&
			this.busy()
		) {
			this.cancel();
			return;
		}
		throw new Error("この操作はPiの最小版では対応していません。");
	}
}
