// Webviewとコマンドの接続先を維持したまま、バックエンドの寿命だけを切り替える。
import { randomUUID } from "node:crypto";
import { initialState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";
import { isUiMessage } from "../../shared/uiMessageValidation";
import type { BackendSession } from "./chatSession";

/** 旧接続の通知を遮断し、終了を待ってから新しい接続を公開する。 */
export class BackendRuntime implements BackendSession {
	private current: BackendSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private listeners = new Set<(event: HostMessage) => void>();
	private revision = 0;
	private restarting: Promise<void> | undefined;
	private closing: Promise<void> | undefined;
	private disposed = false;
	private error: string | null = null;

	/** 設定を毎回読み直すfactoryを保持し、起動時のセッションを作る。 */
	constructor(private readonly factory: () => BackendSession) {
		this.attach(factory());
	}

	/** backend固有の更新番号を、表示先で継続する番号へ変換する。 */
	snapshot() {
		const state = this.current?.snapshot() ?? {
			...initialState(),
			connection: this.error
				? ("error" as const)
				: ("connecting" as const),
			error: this.error,
		};
		return { ...state, revision: this.revision };
	}

	/** セッションを切り替えてもWebviewの購読は維持する。 */
	subscribe(listener: (event: HostMessage) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 切替中の古い会話への操作を拒否し、生成失敗後の再接続を許可する。 */
	async receive(value: unknown): Promise<void> {
		if (this.disposed) {
			return;
		}
		if (this.restarting) {
			if (isUiMessage(value) && "requestId" in value) {
				this.emit({
					type: "request/failed",
					requestId: value.requestId,
					error: "バックエンドを切り替えています。完了後に再試行してください。",
				});
			}
			return;
		}
		if (
			!this.current &&
			isUiMessage(value) &&
			value.type === "connection/retry"
		) {
			await this.restart();
			return;
		}
		await this.current?.receive(value);
	}

	/** 二重切替をまとめ、拡張機能の登録とウィンドウは維持する。 */
	restart(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		if (!this.restarting) {
			this.restarting = this.replace().finally(() => {
				this.restarting = undefined;
			});
		}
		return this.restarting;
	}

	/** ワークスペース変更は現在の接続へ反映する。 */
	invalidate(): void {
		this.current?.invalidate();
	}

	/** 終了中の切替でも新しいbackendを残さない。 */
	dispose(): Promise<void> {
		if (!this.closing) {
			this.disposed = true;
			this.unsubscribe?.();
			this.listeners.clear();
			const current = this.current;
			this.current = undefined;
			this.closing = Promise.all([
				current?.dispose(),
				this.restarting,
			]).then(() => undefined);
		}
		return this.closing;
	}

	/** 表示を初期化して旧backendを閉じ、最新設定から接続を開始する。 */
	private async replace(): Promise<void> {
		const previous = this.current;
		this.unsubscribe?.();
		this.current = undefined;
		this.error = null;
		this.emit({ type: "state/snapshot", state: this.snapshot() });
		try {
			await previous?.dispose();
			if (this.disposed) {
				return;
			}
			const next = this.factory();
			this.attach(next);
			this.emit({ type: "state/snapshot", state: this.snapshot() });
			await next.receive({
				type: "connection/retry",
				requestId: randomUUID(),
			});
		} catch {
			this.error =
				"バックエンドを開始できませんでした。再接続してください。";
			this.emit({
				type: "state/snapshot",
				state: {
					...this.snapshot(),
					connection: "error",
					error: this.error,
				},
			});
		}
	}

	/** 破棄済みbackendから遅れて届く通知を遮断する。 */
	private attach(session: BackendSession): void {
		this.current = session;
		this.unsubscribe = session.subscribe((event) => {
			if (this.current === session && !this.disposed) {
				this.emit(event);
			}
		});
	}

	/** 切替前後のsnapshotとpatchに単調増加する番号を付ける。 */
	private emit(event: HostMessage): void {
		if (this.disposed) {
			return;
		}
		if (event.type === "state/snapshot") {
			event = {
				...event,
				state: { ...event.state, revision: ++this.revision },
			};
		} else if (event.type === "state/patch") {
			// 集約差分の基準番号も変換し、UIが欠落と誤認して復元を繰り返すのを防ぐ。
			const baseRevision = this.revision;
			event = { ...event, baseRevision, revision: ++this.revision };
		}
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
