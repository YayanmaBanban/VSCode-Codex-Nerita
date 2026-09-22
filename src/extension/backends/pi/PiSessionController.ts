// 検証済みWebviewメッセージをPiの最小機能へ接続する。
import type { BackendSession } from "../../session/chatSession";
import { isUiMessage } from "../../../shared/uiMessageValidation";
import type { UiMessage } from "../../../shared/messages";
import { PiHistory } from "./PiHistory";

/** Codexと同じ通信境界で送信・停止・再接続・新規会話を公開する。 */
export class PiSessionController extends PiHistory implements BackendSession {
	private seen = new Set<string>();
	private authAbort: AbortController | undefined;

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
		if (
			message.type === "auth/start" &&
			message.methodId === "pi-cancel" &&
			this.authAbort
		) {
			this.authAbort.abort();
			return;
		}
		if (
			message.type === "auth/start" ||
			message.type === "auth/logout" ||
			message.type === "config/set"
		) {
			await this.configure(message);
			return;
		}
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
		if (
			message.type === "session/load" ||
			message.type === "session/fork"
		) {
			await this.loadSession(
				message.sessionId,
				message.type === "session/fork",
			);
			return;
		}
		if (
			!("sessionId" in message) ||
			message.sessionId !== this.state.sessionId
		) {
			throw new Error("現在のPi会話では実行できない操作です。");
		}
		if (message.type === "prompt/send") {
			if (
				!this.busy() &&
				!this.state.sessionPending &&
				this.runtime?.storageChanged?.()
			) {
				const previous = this.runtime;
				const nextEpoch = this.epoch + 1;
				await this.connect(undefined, true);
				if (
					this.epoch !== nextEpoch ||
					this.runtime === previous ||
					this.state.connection !== "ready"
				) {
					throw new Error(
						this.state.error ||
							"Piの保存先を更新できませんでした。再送してください。",
					);
				}
			}
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

	/** 認証中の再接続・送信を止め、古い接続の結果を公開しない。 */
	private async configure(
		message: Extract<
			UiMessage,
			{ type: "auth/start" | "auth/logout" | "config/set" }
		>,
	): Promise<void> {
		const account = this.runtime?.account;
		if (
			!account ||
			this.busy() ||
			this.state.configPending ||
			this.state.sessionPending ||
			!["ready", "auth-required"].includes(this.state.connection)
		) {
			throw new Error("Piの処理が終わってから設定してください。");
		}
		if (message.type === "auth/start" && message.methodId !== "pi") {
			throw new Error("未対応の認証方法です。");
		}
		if (
			message.type === "config/set" &&
			(message.sessionId !== this.state.sessionId ||
				!this.state.configOptions.some(
					(option) => option.id === message.configId,
				))
		) {
			throw new Error("現在のPiモデル・推論レベル設定ではありません。");
		}
		const epoch = this.epoch;
		const abort = new AbortController();
		this.authAbort = abort;
		const signal = AbortSignal.any([
			this.connectionSignal,
			abort.signal,
			...(message.type === "config/set"
				? [AbortSignal.timeout(180_000)]
				: []),
		]);
		this.patch({
			configPending: true,
			sessionPending: true,
			...(message.type !== "config/set"
				? { connection: "authenticating" as const }
				: {}),
		});
		this.cancelQuota(
			message.type !== "config/set" ||
				message.configId === "provider" ||
				(message.configId === "model" &&
					!this.runtime?.quota?.canRetainForModel?.(message.value)),
		);
		try {
			const operation =
				message.type === "config/set"
					? account.configure(message.configId, message.value, signal)
					: account.authenticate(
							message.type === "auth/logout",
							signal,
						);
			this.track(operation);
			await operation;
		} catch {
			// providerの例外に認証値が含まれる可能性があるため、そのまま表示しない。
			throw new Error(
				"Piの認証・モデル・推論レベル設定を完了できませんでした。取消または設定内容を確認してください。",
			);
		} finally {
			if (this.authAbort === abort) {
				this.authAbort = undefined;
			}
			if (epoch === this.epoch) {
				this.patch({
					...account.snapshot(),
					configPending: false,
					sessionPending: false,
				});
				this.refreshQuota();
			}
		}
	}
}
