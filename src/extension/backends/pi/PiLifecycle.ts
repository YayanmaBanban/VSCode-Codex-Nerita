// 接続世代で古い SDK の結果を排除し、起動・終了中のセッションも回収する。
import { type ChatState, initialState } from "../../../shared/chatState";
import { SessionState } from "../../session/sessionState";
import type { PiFactory, PiSession } from "./PiRuntime";
import type { PiAuthorize } from "./PiApprovedTools";
import type { PiResumeTarget } from "./PiSessionStore";
import { restorePiHistory } from "./PiHistoryMapper";
import type { ContributionContext } from "../../ui-contributions/contributionConditions";

/** 実 Runtime はシェル・子 Runtime まで回収し、テスト接続は従来の SDK 契約を使う。 */
async function closePiSession(session: PiSession): Promise<void> {
	if (session.close) {
		await session.close();
	} else {
		try {
			await session.abort();
		} finally {
			session.dispose();
		}
	}
}

/** Pi の接続と保存セッションの寿命を管理する。 */
export abstract class PiLifecycle extends SessionState {
	/** 選択モデルのプロバイダーはバックエンドとは別に Host で解決する。 */
	protected override contributionContext(): ContributionContext {
		return {
			backend: "pi",
			provider: this.runtime?.model?.provider ?? null,
			capabilities: this.state.configOptions.map((item) => item.id),
		};
	}
	protected runtime: PiSession | undefined;
	private runtimeEpoch: number | undefined;
	protected epoch = 0;
	protected disposed = false;
	private opening: AbortController | undefined;
	private closing = new Set<Promise<unknown>>();
	private quotaAbort: AbortController | undefined;

	/** 旧要求を取り消し、取得元が変わる場合だけ表示値も破棄する。 */
	protected cancelQuota(clear = true): void {
		this.quotaAbort?.abort();
		this.quotaAbort = undefined;
		if (clear && this.state.quota !== null) {
			this.patch({ quota: null });
		}
	}

	/** 利用枠の取得は送信・設定の受付を待たせない。 */
	protected refreshQuota(): void {
		this.cancelQuota(false);
		const runtime = this.runtime;
		if (
			!runtime?.quota ||
			!this.opening ||
			this.state.connection !== "ready"
		) {
			return;
		}
		const abort = new AbortController();
		this.quotaAbort = abort;
		const signal = AbortSignal.any([abort.signal, this.opening.signal]);
		this.track(
			runtime.quota.read(signal).then((quota) => {
				if (!signal.aborted && this.runtime === runtime) {
					this.patch({ quota });
				}
			}),
		);
	}

	/** 履歴取得にも接続終了の取消を伝える。 */
	protected get connectionSignal(): AbortSignal {
		return this.opening!.signal;
	}

	/** SDK 生成を注入し、実接続とテストで同じ状態遷移を使う。 */
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

	/** 旧セッション終了後に新しい SDK セッションを公開する。 */
	async connect(
		resume?: PiResumeTarget,
		preserveCurrent = false,
	): Promise<void> {
		this.assertCanConnect();
		// 初回送信前の保存先変更も、失敗時は元の接続と下書きを維持する。
		const previous = this.prepareConnection(resume, preserveCurrent);
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
					await closePiSession(result.session);
				}
				return result;
			});
			this.track(operation);
			const { session, cwd } = await operation;
			if (epoch !== this.epoch) {
				return;
			}
			const restored: ReturnType<typeof restorePiHistory> =
				this.restoreSessionHistory(session, cwd);
			this.runtime = session;
			this.runtimeEpoch = epoch;
			if (previous) {
				this.track(closePiSession(previous));
			}
			if (session.account) {
				const refresh = session.account.refreshCatalog(opening.signal);
				this.track(refresh);
				await refresh;
				if (epoch !== this.epoch) {
					return;
				}
			}
			this.publishConnectedSession(restored, cwd, session, resume);
		} catch (error) {
			this.reportConnectionFailure(epoch, previous, error);
		}
	}

	/** 必要な場合は元のセッションを保持して接続世代を進める。 */
	private prepareConnection(
		resume: PiResumeTarget | undefined,
		preserveCurrent: boolean,
	) {
		const previous = resume || preserveCurrent ? this.runtime : undefined;
		if (previous) {
			this.epoch++;
			this.opening?.abort();
		} else {
			this.disconnect();
		}
		return previous;
	}

	/** 元の接続を保持しながら再接続失敗を表示する。 */
	private reportConnectionFailure(
		epoch: number,
		previous: PiSession | undefined,
		error: unknown,
	) {
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

	/** 累積課金量ではなく SDK の現在のコンテキスト推定量を共有形式に変換する。 */
	protected contextUsage() {
		const usage = this.runtime?.getContextUsage();
		if (
			!usage ||
			usage.tokens === null ||
			!Number.isFinite(usage.tokens) ||
			usage.tokens < 0 ||
			!Number.isFinite(usage.contextWindow) ||
			usage.contextWindow <= 0
		) {
			return null;
		}
		return { used: usage.tokens, size: usage.contextWindow };
	}

	/** 復元済みの SDK セッションとモデル情報を UI へ公開する。 */
	private publishConnectedSession(
		restored: Pick<ChatState, "messages" | "tools" | "sessionTitle">,
		cwd: string,
		session: PiSession,
		resume: PiResumeTarget | undefined,
	) {
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
			usage: this.contextUsage(),
			skills: session.skills ?? [],
		});
		this.refreshQuota();
	}

	/** 保存履歴が壊れている場合は新しい SDK セッションを回収する。 */
	private restoreSessionHistory(session: PiSession, cwd: string) {
		let restored: ReturnType<typeof restorePiHistory>;
		try {
			restored = restorePiHistory(session.history?.entries ?? [], cwd);
		} catch (error) {
			this.track(closePiSession(session));
			throw error;
		}
		return restored;
	}

	/** 処理中や破棄済みのセッションの再接続を拒否する。 */
	private assertCanConnect() {
		if (
			this.disposed ||
			this.busy() ||
			this.state.sessionPending ||
			this.state.connection === "connecting"
		) {
			throw new Error("Piの処理が終わってから再接続してください。");
		}
	}

	/** 通知を無効化してから SDK の終了を待つ。 */
	private disconnect(): void {
		this.cancelQuota();
		this.epoch++;
		this.opening?.abort();
		this.opening = undefined;
		this.resetRun();
		const runtime = this.runtime;
		this.runtime = undefined;
		this.runtimeEpoch = undefined;
		if (runtime) {
			this.track(closePiSession(runtime));
		}
	}

	/** ワークスペース変更後に旧 `cwd` への送信を禁止する。 */
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
