// 接続世代で古いSDKの結果を排除し、起動・終了中のセッションも回収する。
import { initialState } from "../../../shared/chatState";
import { SessionState } from "../../session/sessionState";
import type { PiFactory, PiSession } from "./PiRuntime";

/** Piの接続と単一メモリセッションの寿命を管理する。 */
export abstract class PiLifecycle extends SessionState {
	protected runtime: PiSession | undefined;
	protected epoch = 0;
	protected disposed = false;
	private opening: AbortController | undefined;
	private closing = new Set<Promise<unknown>>();

	/** SDK生成を注入し、実接続とテストで同じ状態遷移を使う。 */
	constructor(private readonly factory: PiFactory) {
		super();
		this.state.attachmentsSupported = false;
	}

	/** 古い実行の購読・送信待機を無効化する。 */
	protected abstract resetRun(): void;

	/** 終了まで待つ操作の拒否を処理し、追跡から除外する。 */
	protected track(operation: Promise<unknown>): void {
		const settled = operation.catch(() => undefined);
		this.closing.add(settled);
		void settled.then(() => this.closing.delete(settled));
	}

	/** 旧セッション終了後に新しいSDKセッションを公開する。 */
	async connect(): Promise<void> {
		if (
			this.disposed ||
			this.busy() ||
			this.state.connection === "connecting"
		) {
			throw new Error("Piの処理が終わってから再接続してください。");
		}
		this.disconnect();
		const epoch = this.epoch;
		const opening = new AbortController();
		this.opening = opening;
		this.patch({
			connection: "connecting",
			sessionPending: true,
			error: null,
		});
		await Promise.allSettled(this.closing);
		if (epoch !== this.epoch) {
			return;
		}
		try {
			const operation = this.factory(opening.signal).then(
				async (result) => {
					if (epoch !== this.epoch) {
						try {
							await result.session.abort();
						} finally {
							result.session.dispose();
						}
					}
					return result;
				},
			);
			this.track(operation);
			const { session, cwd } = await operation;
			if (epoch !== this.epoch) {
				return;
			}
			this.runtime = session;
			const { revision: _revision, ...empty } = initialState();
			this.patch({
				...empty,
				connection: "ready",
				cwd,
				sessionId: session.sessionId,
				sessionTitle: "Pi",
				attachmentsSupported: false,
				configOptions: session.model
					? [
							{
								id: "model",
								name: "Pi Model",
								currentValue: `${session.model.provider}/${session.model.id}`,
								options: [],
							},
						]
					: [],
			});
		} catch (error) {
			if (epoch === this.epoch) {
				this.patch({
					connection: "error",
					sessionPending: false,
					error:
						error instanceof Error
							? error.message
							: "Piに接続できませんでした。",
				});
			}
		}
	}

	/** 通知を無効化してからSDKの終了を待つ。 */
	private disconnect(): void {
		this.epoch++;
		this.opening?.abort();
		this.opening = undefined;
		this.resetRun();
		const runtime = this.runtime;
		this.runtime = undefined;
		if (runtime) {
			this.track(runtime.abort().finally(() => runtime.dispose()));
		}
	}

	/** workspace変更後に旧cwdへの送信を禁止する。 */
	invalidate(): void {
		this.disconnect();
		const { revision: _revision, ...empty } = initialState();
		this.patch({ ...empty, attachmentsSupported: false });
	}

	/** 起動・送信・停止の待機も含めて終了する。 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.disconnect();
		this.clearListeners();
		await Promise.allSettled(this.closing);
	}
}
