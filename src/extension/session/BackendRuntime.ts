// 表示先とコマンドの接続先を保持し、バックエンドの終了・再生成を管理する。
import type { WorkflowExecution } from "../../shared/workflows/messages";
import { randomUUID } from "node:crypto";
import { initialState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";
import { isUiMessage } from "../../shared/uiMessageValidation";
import type { BackendSession } from "./chatSession";

/** 旧接続の終了を待ち、購読を新しいセッションへ引き継ぐ。 */
export class BackendRuntime implements BackendSession {
	private current: BackendSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private listeners = new Set<(event: HostMessage) => void>();
	private revision = 0;
	private restarting: Promise<void> | undefined;
	private closing: Promise<void> | undefined;
	private disposed = false;
	private error: string | null = null;

	/** 再生成時に最新の設定を取得する関数を保持する。 */
	constructor(private readonly factory: () => BackendSession) {
		this.attach(factory());
	}

	/** 表示先で継続する更新番号を付けて状態を取得する。 */
	snapshot() {
		const state = this.current?.snapshot() ?? initialState();
		return {
			...state,
			...(!this.current ? { connection: "connecting" as const } : {}),
			...(this.error
				? { connection: "error" as const, error: this.error }
				: {}),
			revision: this.revision,
		};
	}

	/** セッションを交換しても表示先の購読を維持する。 */
	subscribe(listener: (event: HostMessage) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 切替中の要求を拒否し、生成失敗後は再接続で復旧できるようにする。 */
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
		this.error = null;
		await this.current?.receive(value);
	}

	/** エディタの実行を現在のバックエンドへ限定する。 */
	async workflow(request: WorkflowExecution, signal: AbortSignal) {
		if (this.disposed || this.restarting || !this.current?.workflow) {
			throw new Error("Pi バックエンドへ接続してください。");
		}
		return this.current.workflow(request, signal);
	}
	/** 同時に届いた切替要求を1つにまとめる。 */
	restart(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		this.restarting ??= this.replace().finally(() => {
			this.restarting = undefined;
		});
		return this.restarting;
	}

	/** ワークスペースの変更を現在の接続へ伝える。 */
	invalidate(): void {
		this.current?.invalidate();
	}

	/** 切替途中でも生成した接続を残さず終了する。 */
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

	/** 旧接続の通知を遮断し、終了後に新しい会話を開始する。 */
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
			this.emit({ type: "state/snapshot", state: this.snapshot() });
		}
	}

	/** 古い接続から遅れて届いた通知を破棄する。 */
	private attach(session: BackendSession): void {
		this.current = session;
		this.unsubscribe = session.subscribe((event) => {
			if (this.current === session && !this.disposed) {
				this.emit(event);
			}
		});
	}

	/** 差分の基準番号も変換し、不要な状態再取得とスクロール復元を防ぐ。 */
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
			const baseRevision = this.revision;
			event = { ...event, baseRevision, revision: ++this.revision };
		}
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
