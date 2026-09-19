// App Server 接続と新規 thread の寿命を、既存の UI 状態ストアへ接続する。
import { initialState } from "../../shared/messages";
import { SessionState } from "../session/sessionState";
import { WorkspaceError } from "../workspace";
import type { CodexClient } from "./CodexClient";
import type { AppServerCallbacks } from "./runtime/AppServerTransport";
import type { AppServerNotification, AppServerRequest } from "./protocol/rpcMessage";
import { AuthFlow, type AuthService } from "./AuthFlow";
import type { StartedThread } from "./protocol/turn";

/** 状態管理に必要な App Server 操作だけを注入する境界。 */
export type CodexConnection = Pick<
	CodexClient,
	| "startThread"
	| "startTurn"
	| "steerTurn"
	| "interruptTurn"
	| "readAccount"
	| "dispose"
	| "listModels"
	| "listMcpServerStatus"
	| "readRateLimits"
	| "login"
	| "cancelLogin"
	| "listThreads"
	| "readThread"
	| "resumeThread"
	| "forkThread"
	| "listTurns"
	| "listItems"
	| "renameThread"
	| "archiveThread"
	| "deleteThread"
	| "unarchiveThread"
> &
	Partial<
		Pick<
			CodexClient,
			"readPersonality" | "changePersonality" | "listSkills"
		>
	>;
/** 起動前のワークスペース検証と、取消可能な接続を提供する。 */
export type CodexFactory = (
	callbacks: AppServerCallbacks,
	signal: AbortSignal,
) => Promise<{ client: CodexConnection; cwd: string }>;

/** 接続世代で古い通知を排除し、起動中のプロセスも終了まで追跡する。 */
export abstract class CodexLifecycle extends SessionState {
	protected client: CodexConnection | undefined;
	protected epoch = 0;
	private abort: AbortController | undefined;
	private closing = new Set<Promise<unknown>>();
	private readonly auth = new AuthFlow();
	/** 実接続とテスト用接続を同じ契約で受け取る。 */
	constructor(
		private readonly factory: CodexFactory,
		private readonly authService?: AuthService,
	) {
		super();
	}
	/** 実行管理に通知を渡す。 */
	protected abstract notification(message: AppServerNotification): void;
	/** 実行範囲が一致する承認だけを UI へ渡す。 */
	protected abstract request(
		message: AppServerRequest,
		signal: AbortSignal,
	): Promise<unknown>;
	/** 実行の待機と承認を解除する。 */
	protected abstract resetRun(): void;
	/** 新しいthreadに機能別の初期状態を準備する。 */
	protected async initializedThread(_thread: StartedThread): Promise<void> {}
	/** ログイン完了後も同じ接続で認証を確認する。 */
	protected async authenticate(method: string): Promise<void> {
		if (
			!this.client ||
			!this.authService ||
			!this.abort ||
			this.state.connection !== "auth-required"
		) {
			throw new Error("Login unavailable");
		}
		const epoch = this.epoch;
		this.patch({ connection: "authenticating", error: null });
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
			if (epoch === this.epoch) {
				this.patch({
					connection: "auth-required",
					error: "ログインできませんでした。認証方法と環境変数を確認して再試行してください。",
				});
			}
		}
	}

	/** 旧接続の終了後に、初期化・認証確認・新規 thread 作成を行う。 */
	async connect(): Promise<void> {
		this.disconnect();
		const epoch = this.epoch;
		const { revision: _revision, ...empty } = initialState();
		this.patch({
			...empty,
			messages: this.state.messages,
			tools: this.state.tools,
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
						if (epoch === this.epoch) {
							if (!this.auth.notification(message)) {
								this.notification(message);
							}
						}
					},
					request: (message, signal) =>
						epoch === this.epoch
							? this.request(message, signal)
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
			this.patch({ cwd });
			const account = await client.readAccount();
			if (epoch !== this.epoch) {
				return;
			}
			if (account.requiresOpenaiAuth && !account.authenticated) {
				this.patch({
					connection: "auth-required",
					authMethods: this.authService
						? [
								{ id: "chatgpt", name: "ChatGPTでログイン" },
								{
									id: "apiKey",
									name: "環境変数のAPIキーを使用",
								},
							]
						: [],
					error: "Codexへのログインが必要です。ログイン方法を選ぶか、同じユーザー環境のCLIでログインして再接続してください。",
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
	protected async newThread(): Promise<void> {
		const client = this.client;
		if (
			!client ||
			!this.state.cwd ||
			this.busy() ||
			this.state.sessionPending
		) {
			throw new Error("Busy");
		}
		const epoch = this.epoch;
		this.patch({ sessionPending: true, error: null });
		try {
			const result = await client.startThread({ cwd: this.state.cwd });
			if (epoch !== this.epoch) {
				return;
			}
			this.resetRun();
			this.patch({
				connection: "ready",
				sessionId: result.thread.id,
				runId: null,
				run: "idle",
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
			await this.initializedThread(result);
		} catch (error) {
			if (epoch === this.epoch) {
				this.patch({
					error: "新規会話を開始できませんでした。再試行してください。",
				});
			}
			throw error;
		} finally {
			if (epoch === this.epoch) {
				this.patch({ sessionPending: false });
			}
		}
	}
	/** 接続と実行の世代を無効化し、全プロセスの終了を追跡する。 */
	private disconnect(): void {
		this.epoch++;
		this.resetRun();
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
	protected failConnection(
		message = "Codexとの接続が終了しました。再接続してください。",
	): void {
		const failed = this.busy();
		this.disconnect();
		this.patch({
			connection: "error",
			sessionsLoading: false,
			sessionsNextCursor: null,
			run: failed ? "failed" : this.state.run,
			sessionPending: false,
			permissions: [],
			error: message,
		});
	}
	/** ワークスペース変更時は旧会話への操作を無効にする。 */
	invalidate(): void {
		const cancelled = this.busy();
		this.disconnect();
		this.patch({
			connection: "disconnected",
			sessionsLoading: false,
			sessionsNextCursor: null,
			sessionId: null,
			cwd: null,
			personality: null,
			sessionPending: false,
			run: cancelled ? "cancelled" : this.state.run,
			permissions: [],
		});
	}
	/** 初期化待ちも含め、拡張機能の終了前に接続を回収する。 */
	async dispose(): Promise<void> {
		this.disconnect();
		this.clearListeners();
		await Promise.allSettled(this.closing);
	}
}
