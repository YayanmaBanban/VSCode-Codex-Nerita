// App Server の接続・切断と新規スレッドの作成を管理し、会話状態へ反映する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import {
	codexAuthMethods,
	codexConnectionText,
} from "@nerita/shared/codexConnection";
import { WorkspaceError } from "../../workspaceError";
import type { CodexConnection, CodexFactory } from "./runtime/connection";
import type {
	AppServerNotification,
	AppServerRequest,
} from "./protocol/rpcMessage";
import { AuthFlow, type AuthService } from "./interaction/AuthFlow";
import type { StartedThread } from "./protocol/turn";

/** 会話状態の管理と通知の振り分けはコントローラーへ委ね、会話の確定後に初期化の完了を待つ。 */
type LifecycleSession = {
	snapshot: () => Readonly<ChatState>;
	busy: () => boolean;
	patch: (change: Partial<ChatState>) => void;
	notification: (message: AppServerNotification) => void;
	request: (
		message: AppServerRequest,
		signal: AbortSignal,
	) => Promise<unknown>;
	resetRun: () => void;
	initializedThread: (thread: StartedThread) => Promise<void>;
};

/** 接続世代で古い通知を排除し、起動中のプロセスも終了まで追跡する。 */
export class CodexLifecycle {
	private client: CodexConnection | undefined;
	private epoch = 0;
	private abort: AbortController | undefined;
	private closing = new Set<Promise<unknown>>();
	private readonly auth = new AuthFlow();
	/** 本番とテストの接続を同じ契約で受け取り、このクラスで接続を管理する。 */
	constructor(
		private readonly session: LifecycleSession,
		private readonly factory: CodexFactory,
		private readonly authService?: AuthService,
	) {}

	/** 接続の更新・終了をコントローラー側で重複して管理しない。 */
	get connection(): CodexConnection | undefined {
		return this.client;
	}

	/** 機能別の非同期処理も同じ接続世代で照合する。 */
	get generation(): number {
		return this.epoch;
	}
	/** ログイン完了後も同じ接続で認証を確認する。 */
	async authenticate(method: string): Promise<void> {
		if (
			!this.client ||
			!this.authService ||
			!this.abort ||
			this.session.snapshot().connection !== "auth-required"
		) {
			throw new Error("Login unavailable");
		}
		const epoch = this.epoch;
		this.session.patch({ connection: "authenticating", error: null });
		try {
			await this.auth.start(
				this.client,
				method,
				this.authService,
				this.abort.signal,
			);
			if (epoch !== this.epoch) {
				return;
			}
			const account = await this.client.readAccount();
			if (epoch !== this.epoch) {
				return;
			}
			if (!account.authenticated && account.requiresOpenaiAuth) {
				throw new Error("Authentication required");
			}
			await this.newThread();
		} catch {
			this.reportAuthenticationFailure(epoch);
		}
	}

	/** 現在の接続で発生したログイン失敗だけを表示する。 */
	private reportAuthenticationFailure(epoch: number) {
		if (epoch === this.epoch) {
			this.session.patch({
				connection: "auth-required",
				error: codexConnectionText.authenticationFailed,
			});
		}
	}

	/** 解除の成功後に旧アカウントの表示と接続を破棄し、認証状態を読み直す。 */
	async logout(): Promise<void> {
		const client = this.client;
		if (
			!client ||
			this.session.snapshot().connection !== "ready" ||
			this.session.busy() ||
			this.session.snapshot().sessionPending
		) {
			throw new Error("Logout unavailable");
		}
		const epoch = this.epoch;
		this.session.patch({ sessionPending: true, error: null });
		try {
			await client.logout();
			if (epoch !== this.epoch) {
				return;
			}
			this.disconnect();
			const { revision: _revision, ...empty } = initialState();
			this.session.patch(empty);
			await this.connect();
		} finally {
			if (epoch === this.epoch) {
				this.session.patch({ sessionPending: false });
			}
		}
	}

	/** 旧接続の終了後は初期化・認証確認を済ませ、新規スレッドを作成する。 */
	async connect(): Promise<void> {
		this.disconnect();
		const epoch = this.epoch;
		const { revision: _revision, ...empty } = initialState();
		this.session.patch({
			...empty,
			messages: this.session.snapshot().messages,
			tools: this.session.snapshot().tools,
			connection: "connecting",
			attachmentsSupported: false,
		});

		await Promise.allSettled(this.closing);
		if (epoch !== this.epoch) {
			return;
		}

		this.abort = new AbortController();
		try {
			const opening = this.factory(
				{
					notification: (message) => {
						if (
							epoch === this.epoch &&
							!this.auth.notification(message)
						) {
							this.session.notification(message);
						}
					},
					request: (message, signal) =>
						epoch === this.epoch
							? this.session.request(message, signal)
							: Promise.resolve({ decision: "cancel" }),
					disconnected: () => {
						if (epoch === this.epoch) {
							this.failConnection();
						}
					},
				},
				this.abort.signal,
			);
			this.track(
				opening.then(async ({ client }) => {
					if (epoch !== this.epoch) {
						await client.dispose();
					}
				}),
			);
			const { client, cwd } = await opening;
			if (epoch !== this.epoch) {
				return;
			}

			this.client = client;
			this.session.patch({ cwd });
			const account = await client.readAccount();
			if (epoch !== this.epoch) {
				return;
			}
			if (account.requiresOpenaiAuth && !account.authenticated) {
				this.session.patch({
					connection: "auth-required",
					authMethods: this.authService ? codexAuthMethods() : [],
				});
				return;
			}
			await this.newThread();
		} catch (error) {
			if (epoch === this.epoch) {
				this.failConnection(
					error instanceof WorkspaceError ? error.message : undefined,
				);
			}
		}
	}

	/** 成功時だけ表示を切り替え、同じプロセスに新しい thread を作る。 */
	async newThread(): Promise<void> {
		const state = this.session.snapshot();
		const client = this.client;
		if (
			!client ||
			!isNonEmptyString(state.cwd) ||
			this.session.busy() ||
			this.session.snapshot().sessionPending
		) {
			throw new Error("Busy");
		}
		const epoch = this.epoch;
		this.session.patch({ sessionPending: true, error: null });
		try {
			const result = await client.startThread({ cwd: state.cwd });
			if (epoch !== this.epoch) {
				return;
			}

			this.session.resetRun();
			this.session.patch({
				connection: "ready",
				sessionId: result.thread.id,
				runId: null,
				run: "idle",
				planDecision: null,
				messages: [],
				tools: [],
				agents: [],
				permissions: [],
				authMethods: [],
				usage: null,
				attachments: [],
				configOptions: [
					{
						id: "model",
						name: "Model",
						currentValue: result.model,
						options: [],
					},
				],
			});
			await this.session.initializedThread(result);
		} catch (error) {
			if (epoch === this.epoch) {
				this.session.patch({
					error: "新規会話を開始できませんでした。再試行してください。",
				});
			}
			throw error;
		} finally {
			if (epoch === this.epoch) {
				this.session.patch({ sessionPending: false });
			}
		}
	}
	/** 接続と実行の世代を無効化し、全プロセスの終了を追跡する。 */
	private disconnect(): void {
		this.epoch++;
		this.session.resetRun();
		this.abort?.abort();
		this.abort = undefined;
		if (this.client) {
			this.track(this.client.dispose());
			this.client = undefined;
		}
	}
	/** 終了待ちを追跡し、未処理の Promise 拒否を残さない。 */
	private track(operation: Promise<unknown>): void {
		const settled = operation.catch(() => undefined);
		this.closing.add(settled);
		void settled.then(() => this.closing.delete(settled));
	}
	/** 実行中の切断は失敗として表示し、再接続できる状態にする。 */
	failConnection(message: string = codexConnectionText.disconnected): void {
		const failed = this.session.busy();
		this.disconnect();
		this.session.patch({
			connection: "error",
			sessionsLoading: false,
			sessionsNextCursor: null,
			run: failed ? "failed" : this.session.snapshot().run,
			sessionPending: false,
			permissions: [],
			error: message,
		});
	}
	/** ワークスペース変更時は旧会話への操作を無効にする。 */
	invalidate(): void {
		const cancelled = this.session.busy();
		this.disconnect();
		this.session.patch({
			connection: "disconnected",
			sessionsLoading: false,
			sessionsNextCursor: null,
			sessionId: null,
			cwd: null,
			personality: null,
			sessionPending: false,
			run: cancelled ? "cancelled" : this.session.snapshot().run,
			permissions: [],
		});
	}
	/** 初期化待ちも含め、拡張機能の終了前に接続を回収する。 */
	async dispose(): Promise<void> {
		this.disconnect();
		await Promise.allSettled(this.closing);
	}
}
