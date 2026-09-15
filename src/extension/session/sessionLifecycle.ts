// ACPの起動・認証・接続世代とプロセス終了を管理する。
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { isRecord } from "../../shared/validation";
import type { AcpCallbacks, AcpTransport } from "../acp/transport";
import { SessionState } from "./sessionState";
import { updateState } from "./updates";
import { WorkspaceError } from "../workspace";
import { initialConfig } from "./configuration";
import { updateAsyncTasks } from "./asyncTasks";
/** 起動条件をHostで検査して接続を作るファクトリ。 */
export type TransportFactory = (callbacks: AcpCallbacks) => AcpTransport;
/** 接続の寿命を会話の実行制御から分離する。 */
export class SessionLifecycle extends SessionState {
	protected transport: AcpTransport | undefined;
	protected epoch = 0;
	private closing = new Set<Promise<void>>();
	/** 実接続とテスト用接続の差し替え境界を受け取る。 */
	constructor(private factory: TransportFactory) {
		super();
	}
	/** 旧接続の通知を無効化し、保留中の処理を解消する。 */
	protected disconnect(): void {
		this.epoch++;
		this.patch({
			configPending: false,
			attachmentPending: false,
			quota: null,
		});
		clearTimeout(this.cancelTimer);
		this.permissions.cancelAll();
		if (this.transport) {
			const closing = this.transport.dispose();
			this.closing.add(closing);
			void closing
				.finally(() => this.closing.delete(closing))
				.catch(() => undefined);
			this.transport = undefined;
		}
	}
	/** 起動・初期化・会話作成を行う。 */
	async connect(): Promise<void> {
		this.disconnect();
		const epoch = this.epoch;
		this.patch({
			connection: "connecting",
			run: "idle",
			runId: null,
			sessionId: null,
			permissions: [],
			error: null,
			authMethods: [],
			usage: null,
		});
		// 終了前の旧プロセスと新プロセスが同時に作業しないよう待つ。
		await Promise.allSettled(this.closing);
		if (epoch !== this.epoch) {
			return;
		}
		try {
			const transport = this.factory(this.callbacks(epoch));
			this.transport = transport;
			const response = await transport.initialize();
			if (epoch !== this.epoch) {
				return;
			}
			if (response.protocolVersion !== PROTOCOL_VERSION) {
				throw new Error("Unsupported protocol");
			}
			this.patch({
				authMethods: (response.authMethods ?? [])
					.filter((m) => ["chat-gpt", "api-key"].includes(m.id))
					.map((m) => ({ id: m.id, name: m.name })),
			});
			await this.openSession(transport, epoch);
		} catch (error) {
			if (epoch === this.epoch) {
				this.connectionError(error);
			}
		}
	}
	/** 接続世代とセッションを確認して通知を受け付ける。 */
	private callbacks(epoch: number): AcpCallbacks {
		return {
			asyncTask: (update) => {
				if (epoch !== this.epoch) {
					return;
				}
				const patch = updateAsyncTasks(this.state, update);
				if (Object.keys(patch).length) {
					this.patch(patch);
				}
			},
			update: (notification) => {
				if (epoch !== this.epoch) {
					return;
				}
				const patch = updateState(this.state, notification);
				if (Object.keys(patch).length) {
					this.patch(patch);
				}
			},
			permission: (request) => {
				if (
					epoch !== this.epoch ||
					request.sessionId !== this.state.sessionId ||
					this.state.run !== "running"
				) {
					return Promise.resolve({
						outcome: { outcome: "cancelled" },
					});
				}
				const result = this.permissions.request(request);
				this.patch({ permissions: this.permissions.list() });
				return result;
			},
			disconnected: () => {
				if (epoch === this.epoch) {
					this.failConnection();
				}
			},
		};
	}
	/** 認証方法は初期化時に提示されたIDだけを受理する。 */
	protected async authenticate(methodId: string): Promise<void> {
		if (
			this.state.connection !== "auth-required" ||
			!this.transport ||
			!this.state.authMethods.some((m) => m.id === methodId)
		) {
			throw new Error("Invalid auth");
		}
		const epoch = this.epoch;
		const transport = this.transport;
		this.patch({ connection: "authenticating", error: null });
		try {
			await transport.authenticate(methodId);
			if (epoch === this.epoch) {
				await this.openSession(transport, epoch);
			}
		} catch (error) {
			if (epoch === this.epoch) {
				this.connectionError(error);
			}
		}
	}
	/** 会話作成が成功してから表示中の履歴を切り替える。 */
	private async openSession(
		transport: AcpTransport,
		epoch: number,
	): Promise<void> {
		const session = await transport.newSession();
		if (epoch === this.epoch) {
			this.patch({
				connection: "ready",
				sessionId: session.sessionId,
				run: "idle",
				runId: null,
				messages: [],
				tools: [],
				asyncTasks: [],
				permissions: [],
				error: null,
				configOptions: initialConfig(session),
				attachments: [],
				usage: null,
			});
			void this.refreshQuota();
		}
	}
	/** 接続の世代を照合し、古い取得結果で新しい会話を上書きしない。 */
	protected async refreshQuota(): Promise<void> {
		const epoch = this.epoch;
		if (!this.transport || !this.state.sessionId || this.busy()) {
			return;
		}
		const quota = await this.transport.readStatus(this.state.sessionId);
		if (epoch === this.epoch) {
			this.patch({ quota });
		}
	}
	/** 認証不足を通常の接続失敗から区別する。 */
	protected connectionError(error: unknown): void {
		if (error instanceof WorkspaceError) {
			this.failConnection(error.message);
		} else if (isRecord(error) && error.code === -32000) {
			this.patch({
				connection: "auth-required",
				error: "Codexへのログインが必要です。",
			});
		} else {
			this.failConnection();
		}
	}
	/** 接続を破棄し、処理中の要求を終了させる。 */
	protected failConnection(
		message = "Codexに接続できませんでした。Node.jsの設定を確認し、再接続してください。",
	): void {
		this.disconnect();
		this.patch({
			connection: "error",
			run: this.busy() ? "failed" : this.state.run,
			permissions: [],
			error: message,
		});
	}
	/** ワークスペース変更時は購読を保ったまま接続を無効にする。 */
	invalidate(): void {
		this.disconnect();
		this.patch({
			connection: "disconnected",
			sessionId: null,
			run: this.busy() ? "cancelled" : this.state.run,
			permissions: [],
		});
	}
	/** 拡張機能の終了時に子プロセス終了を待つ。 */
	async dispose(): Promise<void> {
		this.disconnect();
		this.clearListeners();
		await Promise.allSettled(this.closing);
	}
}
