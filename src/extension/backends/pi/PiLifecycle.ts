// 接続世代で古いSDKの結果を排除し、起動・終了中のセッションも回収する。
import { initialState } from "../../../shared/chatState";
import { SessionState } from "../../session/sessionState";
import type { PiFactory, PiSession } from "./PiRuntime";
import type { PiAuthorize } from "./PiApprovedTools";
import type { PiResumeTarget } from "./PiSessionStore";
import { restorePiHistory } from "./PiHistoryMapper";

/** Piの接続と保存セッションの寿命を管理する。 */
export abstract class PiLifecycle extends SessionState {
	protected runtime: PiSession | undefined;
	private runtimeEpoch: number | undefined;
	protected epoch = 0;
	protected disposed = false;
	private opening: AbortController | undefined;
	private closing = new Set<Promise<unknown>>();
	/** 履歴取得にも接続終了の取消を伝える。 */
	protected get connectionSignal(): AbortSignal {
		return this.opening!.signal;
	}

	/** SDK生成を注入し、実接続とテストで同じ状態遷移を使う。 */
	constructor(private readonly factory: PiFactory) {
		super();
		this.state.attachmentsSupported = false;
	}

	/** 古い実行の購読・送信待機を無効化する。 */
	protected abstract resetRun(): void;
	/** 現在の実行に属する承認だけを受け付ける。 */
	protected abstract authorize: PiAuthorize;

	/** 終了まで待つ操作の拒否を処理し、追跡から除外する。 */
	protected track(operation: Promise<unknown>): void {
		const settled = operation.catch(() => undefined);
		this.closing.add(settled);
		void settled.then(() => this.closing.delete(settled));
	}

	/** 旧セッション終了後に新しいSDKセッションを公開する。 */
	async connect(
		resume?: PiResumeTarget,
		preserveCurrent = false,
	): Promise<void> {
		if (
			this.disposed ||
			this.busy() ||
			this.state.sessionPending ||
			this.state.connection === "connecting"
		) {
			throw new Error("Piの処理が終わってから再接続してください。");
		}
		// 初回送信前の保存先変更も、失敗時は元の接続と下書きを維持する。
		const previous = resume || preserveCurrent ? this.runtime : undefined;
		if (previous) {
			this.epoch++;
			this.opening?.abort();
		} else {
			this.disconnect();
		}
		const epoch = this.epoch;
		const opening = new AbortController();
		this.opening = opening;
		this.patch({
			connection: previous ? "ready" : "connecting",
			sessionPending: true,
			sessionsLoading: false,
			sessionsError: null,
			error: null,
		});
		await Promise.allSettled(this.closing);
		if (epoch !== this.epoch) {
			return;
		}
		try {
			const operation = this.factory(
				opening.signal,
				(title, signal) => {
					if (epoch !== this.epoch && epoch !== this.runtimeEpoch) {
						return Promise.reject(
							new Error("古いPi接続の操作です。"),
						);
					}
					return this.authorize(title, signal);
				},
				resume,
			).then(async (result) => {
				if (epoch !== this.epoch) {
					try {
						await result.session.abort();
					} finally {
						result.session.dispose();
					}
				}
				return result;
			});
			this.track(operation);
			const { session, cwd } = await operation;
			if (epoch !== this.epoch) {
				return;
			}
			let restored: ReturnType<typeof restorePiHistory>;
			try {
				restored = restorePiHistory(
					session.history?.entries ?? [],
					cwd,
				);
			} catch (error) {
				this.track(session.abort().finally(() => session.dispose()));
				throw error;
			}
			this.runtime = session;
			this.runtimeEpoch = epoch;
			if (previous) {
				this.track(previous.abort().finally(() => previous.dispose()));
			}
			this.resetRun();
			const { revision: _revision, ...empty } = initialState();
			this.patch({
				...empty,
				...restored,
				connection: "ready",
				cwd,
				sessionId: session.sessionId,
				sessions: resume ? this.state.sessions : [],
				sessionCapabilities: {
					list: !!session.history,
					load: !!session.history,
					fork: !!session.history,
					delete: false,
					rename: false,
					archive: false,
					unarchive: false,
				},
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
				...session.account?.snapshot(),
				skills: session.skills ?? [],
			});
		} catch (error) {
			if (epoch === this.epoch) {
				this.patch({
					connection: previous ? "ready" : "error",
					sessionPending: false,
					error:
						error instanceof Error
							? error.message
							: "Piに接続できませんでした。",
					...(previous
						? {
								sessionsError:
									error instanceof Error
										? error.message
										: "Piの履歴を開けませんでした。",
							}
						: {}),
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
		this.runtimeEpoch = undefined;
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
