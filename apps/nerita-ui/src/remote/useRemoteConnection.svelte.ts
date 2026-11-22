// 認証、再接続、PC と共有する通常チャットの操作を管理する。
import { onMount } from "svelte";
import type {
	RemoteAction,
	RemoteChatState,
} from "@nerita/shared/remote/contracts";
import { RemoteResponseError, type RemoteTransport } from "./api";

export const remoteBackendLabels = { pi: "Pi", codex: "Codex" } as const;

/** UI とファイル表示の境界。 */
type ConnectionOptions = {
	getTransport: () => RemoteTransport;
	getHostname: () => string | undefined;
	onResetFiles: () => void;
	onRefreshFiles: () => void;
};

/** モバイル画面の寿命に接続を結び付け、読み込んだ同じ会話を再開する。 */
export function useRemoteConnection(options: ConnectionOptions) {
	return new RemoteConnection(options);
}

/** モバイル画面の寿命に接続を結び付け、読み込んだ同じ会話を再開する。 */
class RemoteConnection {
	/** 描画に合わせて接続と後片付けを登録する。 */
	constructor(private readonly options: ConnectionOptions) {
		onMount(() => {
			this.host = this.options.getHostname() ?? location.hostname;
			this.offline = !navigator.onLine;
			void this.restore();
			return () => {
				this.lifetime.abort();
				this.source?.close();
				clearTimeout(this.retry);
			};
		});
	}

	chat = $state.raw<RemoteChatState>();

	access = $state<"loading" | "pair" | "chat">("loading");

	connected = $state(false);

	offline = $state(false);

	private connectionProblem = $state("");

	pending = $state(false);

	draft = $state("");

	feedback = $state("");

	csrf = "";

	private source: ReturnType<RemoteTransport["connectEvents"]> | undefined;

	private retry: ReturnType<typeof setTimeout> | undefined;

	private lifetime = new AbortController();

	private restoring = false;

	host = $state("");

	private runLabels = {
		idle: "待機中",
		running: "実行中",
		cancelling: "停止中",
		completed: "完了",
		cancelled: "停止済み",
		failed: "実行エラー",
	} as const;

	private connectionLabels = {
		disconnected: "PCでバックエンドに接続してください",
		connecting: "バックエンド接続中",
		"auth-required": "PCで認証してください",
		authenticating: "PCで認証中",
		error: "PCでバックエンドを確認してください",
	} as const;

	status = $derived(
		this.connectionStatus(
			this.chat,
			this.offline,
			this.connected,
			this.connectionProblem,
		),
	);

	canOperate = $derived(this.connected && !this.offline && !this.pending);

	private hasText = $derived(this.draft.trim().length > 0);

	/** 端末の通信状態とバックエンド自身の状態を順に表示する。 */
	private connectionStatus(
		current: RemoteChatState | undefined,
		isOffline: boolean,
		online: boolean,
		problem: string,
	): string {
		if (isOffline) {
			return "端末がオフラインです";
		}
		if (!online || current === undefined) {
			return problem === "" ? "PC接続待ち" : problem;
		}
		if (current.switching) {
			return "切替中";
		}
		return current.connection === "ready"
			? this.runLabels[current.run]
			: this.connectionLabels[current.connection];
	}

	/** 非同期取得の完了がコンポーネントの寿命を越えていないかを調べる。 */
	private disposed = () => {
		return this.lifetime.signal.aborted;
	};

	/** 現在の接続とバックエンドの世代を照合し、遅れて届いた状態を捨てる。 */
	private accept = (snapshot: RemoteChatState) => {
		if (this.chat !== undefined) {
			const wrongConnection =
				this.chat.connectionGeneration !==
				snapshot.connectionGeneration;
			const sameBackend =
				this.chat.backendGeneration === snapshot.backendGeneration;
			const staleRevision =
				sameBackend && this.chat.revision > snapshot.revision;
			const staleBackend =
				this.chat.backendGeneration > snapshot.backendGeneration;
			if (wrongConnection || staleRevision || staleBackend) {
				return;
			}
		}
		const newSession = this.chat?.sessionId !== snapshot.sessionId;
		const newBackend =
			this.chat?.backendGeneration !== snapshot.backendGeneration;
		if (newSession || newBackend) {
			this.options.onResetFiles();
		}
		this.chat = snapshot;
	};

	/** 端末認証を失ったら、接続と画面に保持した会話を破棄する。 */
	private unpair = (message = "") => {
		this.source?.close();
		this.source = undefined;
		clearTimeout(this.retry);
		this.retry = undefined;
		this.access = "pair";
		this.options.onResetFiles();
		this.connected = false;
		this.connectionProblem = "";
		this.chat = undefined;
		this.draft = "";
		this.csrf = "";
		this.feedback = message;
	};

	/** 通信断の間は操作を止め、最新状態の取得を待つ。 */
	private reconnect = () => {
		this.connected = false;
		this.retry ??= setTimeout(() => {
			this.retry = undefined;
			void this.restore();
		}, 2000);
	};

	/** 起動時と通信復帰時に認証と最新状態を確認する。 */
	private restore = async () => {
		if (this.restoring || this.disposed()) {
			return;
		}
		this.restoring = true;
		try {
			const snapshot = await this.options.getTransport().bootstrap();
			if (!this.disposed()) {
				this.resume(snapshot);
			}
		} catch (error) {
			if (this.disposed()) {
				return;
			}
			if (error instanceof RemoteResponseError && error.status === 401) {
				this.unpair(
					this.access === "chat"
						? "接続の有効期限が切れました。再ペアリングしてください。"
						: "",
				);
			} else {
				this.connectionProblem =
					error instanceof RemoteResponseError
						? "PCのNeritaに接続できません"
						: "Tailscaleの接続を確認してください";
				this.reconnect();
			}
		} finally {
			this.restoring = false;
		}
	};

	/** 新しい Host では旧状態を捨て、SSE の初回状態を受け取ってから操作を再開する。 */
	private resume = (
		baseline: Awaited<ReturnType<RemoteTransport["bootstrap"]>>,
	) => {
		this.csrf = baseline.csrf;
		this.connectionProblem = "";
		const newHost =
			this.chat?.connectionGeneration !==
			baseline.state.connectionGeneration;
		if (newHost) {
			this.chat = undefined;
		}
		this.accept(baseline.state);
		this.access = "chat";
		const liveSource =
			this.source !== undefined &&
			this.source.readyState !== EventSource.CLOSED;
		if (liveSource) {
			return;
		}
		this.source = this.options.getTransport().connectEvents((current) => {
			const otherHost =
				this.chat?.connectionGeneration !==
				current.connectionGeneration;
			if (otherHost) {
				this.source?.close();
				this.reconnect();
				return;
			}
			this.acceptLive(current);
			clearTimeout(this.retry);
			this.retry = undefined;
		}, this.reconnect);
	};

	/** 初回接続と会話切替で、左に表示する内容を最新にする。 */
	private acceptLive = (current: RemoteChatState) => {
		const arrived = !this.connected || this.chat?.connection !== "ready";
		const newSession = this.chat?.sessionId !== current.sessionId;
		const newBackend =
			this.chat?.backendGeneration !== current.backendGeneration;
		this.accept(current);
		this.connected = true;
		const shouldRefresh = arrived || newSession || newBackend;
		if (shouldRefresh && this.chat?.connection === "ready") {
			void this.manageSession(this.chat, "session.list");
			this.options.onRefreshFiles();
		}
	};

	/** PC で発行したコードを送信し、認証後の状態を読み込む。 */
	submitCode = async (code: string) => {
		if (this.pending) {
			return;
		}
		this.pending = true;
		this.feedback = "";
		try {
			await this.options.getTransport().pair(code);
			await this.restore();
		} catch (error) {
			this.feedback =
				error instanceof RemoteResponseError
					? error.message
					: "PCのNeritaとTailscaleの接続を確認してください。";
		} finally {
			this.pending = false;
		}
	};

	/** 副作用のある操作を一度だけ送り、競合時は状態を再取得する。 */
	private operate = async (action: RemoteAction): Promise<boolean> => {
		if (!this.canOperate) {
			return false;
		}
		this.pending = true;
		this.feedback = "";
		try {
			await this.options.getTransport().sendAction(action, this.csrf);
			return true;
		} catch (error) {
			if (error instanceof RemoteResponseError) {
				if (error.status === 401) {
					this.unpair(error.message);
				} else {
					this.feedback = error.message;
				}
				if (error.status === 409) {
					await this.restore();
				}
			} else {
				this.feedback =
					"操作結果を確認できませんでした。再試行する前に会話を確認してください。";
				this.source?.close();
				this.reconnect();
			}
			return false;
		} finally {
			this.pending = false;
		}
	};

	/** PC の通常セッションの一覧取得・復元・新規作成に同じ通信経路を使う。 */
	manageSession = async (
		current: RemoteChatState,
		type: "session.list" | "session.new",
		id?: string,
	) => {
		const target = {
			expectedSessionId: current.sessionId,
			backendGeneration: current.backendGeneration,
			requestId: crypto.randomUUID(),
		};
		const changing = type === "session.new" || id !== undefined;
		const hasDraft = this.draft.trim().length > 0;
		const discard = changing && hasDraft;
		const message = "下書きを破棄して会話を切り替えますか？";
		if (discard && !window.confirm(message)) {
			return;
		}
		const action: RemoteAction =
			id === undefined
				? { type, ...target }
				: { type: "session.load", sessionId: id, ...target };
		const ok = await this.operate(action);
		if (ok && changing) {
			this.draft = "";
		}
		return ok;
	};

	/** 表示中の会話へ入力を送り、成功時だけ送った下書きを消す。 */
	submitPrompt = async () => {
		const sessionId = this.chat?.sessionId;
		const noSession = sessionId === null || sessionId === undefined;
		if (this.chat === undefined || noSession) {
			return;
		}
		if (!this.chat.capabilities.send || !this.hasText) {
			return;
		}
		const text = this.draft;
		const ok = await this.operate({
			type: "prompt.send",
			requestId: crypto.randomUUID(),
			sessionId,
			text,
			backendGeneration: this.chat.backendGeneration,
		});
		if (ok && text === this.draft) {
			this.draft = "";
		}
	};

	/** 表示中の実行 ID を付けて停止する。 */
	stopRun = (current: RemoteChatState) => {
		if (current.sessionId === null || current.runId === null) {
			return;
		}
		void this.operate({
			type: "run.stop",
			requestId: crypto.randomUUID(),
			sessionId: current.sessionId,
			runId: current.runId,
			backendGeneration: current.backendGeneration,
		});
	};

	/** 現在の承認の対象を確認して、単発の判断を送る。 */
	answer = async (
		current: RemoteChatState,
		approval: RemoteChatState["pendingApprovals"][number],
		option: RemoteChatState["pendingApprovals"][number]["options"][number],
	) => {
		if (current.sessionId === null || current.runId === null) {
			return;
		}
		const question = `${approval.title}\nこの操作を今回だけ許可しますか？ 詳細はPCで確認できます。`;
		if (option.kind === "allow" && !window.confirm(question)) {
			return;
		}
		const ok = await this.operate({
			type: "approval.respond",
			requestId: crypto.randomUUID(),
			sessionId: current.sessionId,
			runId: current.runId,
			permissionId: approval.id,
			optionId: option.id,
			backendGeneration: current.backendGeneration,
		});
		if (ok) {
			this.feedback =
				option.kind === "allow"
					? "今回だけ許可しました。"
					: "拒否しました。";
		}
	};

	/** 会話の境界を確認してから、表示中の世代で切替を要求する。 */
	selectBackend = async (
		current: RemoteChatState,
		backend: RemoteChatState["backend"],
	) => {
		const question = `${remoteBackendLabels[backend]} に切り替えますか？ 現在の会話履歴は引き継がれません。`;
		if (!window.confirm(question)) {
			return;
		}
		const ok = await this.operate({
			type: "backend.select",
			requestId: crypto.randomUUID(),
			backend,
			expectedBackend: current.backend,
			backendGeneration: current.backendGeneration,
		});
		if (ok) {
			this.draft = "";
		}
	};

	/** 接続を解除し、画面の会話と認証状態を消す。 */
	disconnect = async () => {
		if (!this.canOperate) {
			return;
		}
		this.pending = true;
		try {
			await this.options.getTransport().logout(this.csrf);
			this.unpair("端末を解除しました。");
		} catch (error) {
			if (error instanceof RemoteResponseError && error.status === 401) {
				this.unpair(error.message);
			} else {
				this.feedback =
					"接続解除を確認できませんでした。PCから接続端末を解除できます。";
			}
		} finally {
			this.pending = false;
		}
	};

	/** 端末のネットワーク復帰時に、認証と最新の会話を確認する。 */
	goOnline = () => {
		this.offline = false;
		void this.restore();
	};

	/** オフライン中は保留操作を止め、再接続に備える。 */
	goOffline = () => {
		this.offline = true;
		this.source?.close();
		this.reconnect();
	};

	/** 変更ファイルの操作結果をチャットの下端に通知する。 */
	notify = (message: string) => {
		this.feedback = message;
	};
}
