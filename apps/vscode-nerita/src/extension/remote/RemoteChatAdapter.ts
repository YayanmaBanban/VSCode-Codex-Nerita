// 許可したモバイル操作を既存のチャットセッションへ渡す。
import { RemoteFiles } from "./RemoteFiles";
import type { RemoteFilesRequest } from "@nerita/shared/remote/files";
import type { RemoteAction } from "@nerita/shared/remote/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import type { BackendId } from "@nerita/shared/backend";
import type { ChatSession } from "../session/chatSession";
import { sessionWriting } from "../session/DirectoryRuns";
import type { BackendSelection } from "../backends/BackendSelection";
import { RemoteError } from "./RemoteError";
import {
	canSendRemote,
	projectRemoteState,
	remoteApproval,
} from "./RemoteStateProjection";

/** 既存セッションの境界にリモート固有の認可を追加する。 */
export class RemoteChatAdapter {
	private readonly files = new RemoteFiles();
	/** チャットと切替の共有サービスを使い、別の実行接続を生成しない。 */
	constructor(
		private readonly chat: ChatSession,
		private readonly selection: BackendSelection,
		private readonly workspaceTrusted: () => boolean,
		private readonly rootTrusted: (
			root: string,
			backend: BackendId,
		) => Promise<boolean>,
		private readonly trustGeneration: () => number,
	) {}

	/** 公開項目だけを現在のチャットから取得する。 */
	snapshot(connectionGeneration: string) {
		return projectRemoteState(
			this.chat.snapshot(),
			this.selection,
			connectionGeneration,
			this.workspaceTrusted(),
		);
	}

	/** 承認・終了・切替は優先し、それ以外は配信側で間引く。 */
	subscribe(notify: (urgent: boolean) => void) {
		const stopSelection = this.selection.subscribe(() => notify(true));
		const stopChat = this.chat.subscribe((event) => {
			if (event.type === "state/snapshot") {
				notify(true);
			}
			if (event.type === "state/patch") {
				const connectionChanged = "connection" in event.patch;
				const ended =
					"run" in event.patch && event.patch.run !== "running";
				const urgent =
					"permissions" in event.patch || connectionChanged || ended;
				notify(urgent);
			}
		});
		return () => {
			stopSelection();
			stopChat();
		};
	}

	/** 対象と認可条件を固定し、配送直前にも最新状態を照合する。 */
	async apply(action: RemoteAction, authorized: () => boolean) {
		const { backend } = this.checkGeneration(action);
		if (action.type === "backend.select") {
			await this.select(action);
			return;
		}
		const { cwd } = this.chat.snapshot();
		const trustGeneration = this.trustGeneration();
		const requiresTrust = action.type !== "run.stop";
		if (requiresTrust) {
			await this.checkTrust(cwd, backend);
		}
		/** 待機中に認証、会話、信頼のいずれかが変わったら配送しない。 */
		const authorize = () => {
			if (!authorized()) {
				throw new RemoteError("unauthenticated");
			}
			this.checkGeneration(action);
			const sameTrust =
				trustGeneration === this.trustGeneration() &&
				this.chat.snapshot().cwd === cwd;
			if (requiresTrust && !(sameTrust && this.workspaceTrusted())) {
				throw new RemoteError("forbidden");
			}
			return this.message(action);
		};
		const message = authorize();
		let failure: Error | undefined;
		const unsubscribe = this.chat.subscribe((event) => {
			const rejected =
				event.type === "request/failed" &&
				event.requestId === action.requestId;
			if (rejected) {
				failure ??= new RemoteError("backend_unavailable");
			}
		});
		try {
			await this.chat.receive(message, () => {
				try {
					authorize();
				} catch (error) {
					failure =
						error instanceof Error
							? error
							: new RemoteError("host_unavailable");
					throw failure;
				}
			});
			if (failure !== undefined) {
				throw failure;
			}
		} finally {
			unsubscribe();
		}
	}

	/** ファイルと Git 操作を、認証済みの同じ通常チャットに結び付ける。 */
	async workspace(request: RemoteFilesRequest, authorized: () => boolean) {
		const { backend } = this.checkGeneration(request);
		const { cwd } = this.chat.snapshot();
		const generation = this.trustGeneration();
		await this.checkTrust(cwd, backend);
		if (cwd === null) {
			throw new RemoteError("forbidden");
		}
		/** 待機中に認証や会話が変わったら、それ以上操作しない。 */
		const authorize = () => {
			if (!authorized()) {
				throw new RemoteError("unauthenticated");
			}
			this.checkGeneration(request);
			const state = this.chat.snapshot();
			if (state.sessionId !== request.sessionId || state.cwd !== cwd) {
				throw new RemoteError("stale_session");
			}
			const trustChanged = generation !== this.trustGeneration();
			if (trustChanged || !this.workspaceTrusted()) {
				throw new RemoteError("forbidden");
			}
			const mutation = request.type !== "list" && request.type !== "read";
			if (mutation && this.selection.busy(state)) {
				throw new RemoteError("backend_switch_busy");
			}
		};
		authorize();
		return this.files.apply(request, cwd, authorize);
	}

	/** バックエンド選択は PC と同じ排他と設定保存を通す。 */
	private async select(
		action: Extract<RemoteAction, { type: "backend.select" }>,
	): Promise<void> {
		const result = await this.selection.select(action.backend, {
			backend: action.expectedBackend,
			generation: action.backendGeneration,
		});
		if (result === "ok") {
			return;
		}
		const failures = {
			busy: "backend_switch_busy",
			stale: "stale_backend",
			unavailable: "backend_unavailable",
		} as const;
		throw new RemoteError(failures[result]);
	}

	/** VS Code と実際の会話ルートの両方に対する信頼を要求する。 */
	private async checkTrust(
		cwd: string | null,
		backend: BackendId,
	): Promise<void> {
		if (!this.workspaceTrusted() || cwd === null) {
			throw new RemoteError("forbidden");
		}
		const trusted = await this.rootTrusted(cwd, backend);
		if (!trusted) {
			throw new RemoteError("forbidden");
		}
	}

	/** 切替前の操作と切替中の操作を拒否する。 */
	private checkGeneration(action: { backendGeneration: number }) {
		const current = this.selection.current();
		if (action.backendGeneration !== current.generation) {
			throw new RemoteError("stale_backend");
		}
		if (current.switching) {
			throw new RemoteError("backend_switch_busy");
		}
		return current;
	}

	/** 現在の会話に向けた操作だけを既存の通信型に変換する。 */
	private message(
		action: Exclude<RemoteAction, { type: "backend.select" }>,
	): UiMessage {
		const state = this.chat.snapshot();
		if ("expectedSessionId" in action) {
			return this.sessionMessage(action, state);
		}
		const { sessionId } = action;
		if (sessionId !== state.sessionId) {
			throw new RemoteError("stale_session");
		}
		if (state.connection !== "ready") {
			throw new RemoteError("backend_unavailable");
		}
		const message =
			action.type === "prompt.send"
				? this.prompt(action, state)
				: this.runAction(action, state);
		if (!isUiMessage(message)) {
			throw new RemoteError("invalid_request");
		}
		return message;
	}

	/** 最新の会話と一覧を照合してから、既存の通常履歴経路に渡す。 */
	private sessionMessage(
		action: Extract<RemoteAction, { expectedSessionId: string | null }>,
		state: ReturnType<ChatSession["snapshot"]>,
	): UiMessage {
		if (action.expectedSessionId !== state.sessionId) {
			throw new RemoteError("stale_session");
		}
		if (state.connection !== "ready") {
			throw new RemoteError("backend_unavailable");
		}
		const { requestId } = action;
		if (action.type === "session.list") {
			return { type: "session/list", requestId };
		}
		if (this.selection.busy(state)) {
			throw new RemoteError("backend_switch_busy");
		}
		if (action.type === "session.new") {
			return { type: "session/new", requestId };
		}
		const entry = state.sessions.find(
			(item) => item.sessionId === action.sessionId,
		);
		if (entry?.cwd !== state.cwd || entry.archived === true) {
			throw new RemoteError("stale_session");
		}
		return { type: "session/load", requestId, sessionId: action.sessionId };
	}

	/** 添付やローカルコマンドを含まないテキスト入力を受け付ける。 */
	private prompt(
		action: Extract<RemoteAction, { type: "prompt.send" }>,
		state: ReturnType<ChatSession["snapshot"]>,
	): UiMessage {
		// バックエンドのローカルコマンドや拡張コマンドを送信経路から実行させない。
		if (action.text.trimStart().startsWith("/")) {
			throw new RemoteError("forbidden");
		}
		if (!canSendRemote(state)) {
			throw new RemoteError("backend_switch_busy");
		}
		return {
			type: "prompt/send",
			requestId: action.requestId,
			sessionId: action.sessionId,
			text: action.text,
		};
	}

	/** 表示中の実行と承認の組で既存経路へ変換する。 */
	private runAction(
		action: Extract<RemoteAction, { runId: string }>,
		state: ReturnType<ChatSession["snapshot"]>,
	): UiMessage {
		const { sessionId, runId, requestId } = action;
		if (runId !== state.runId) {
			throw new RemoteError("stale_run");
		}
		if (action.type === "run.stop") {
			if (!sessionWriting(state) || state.run === "cancelling") {
				throw new RemoteError("stale_run");
			}
			return { type: "prompt/cancel", sessionId, runId, requestId };
		}
		const { permissionId, optionId } = action;
		const permission = state.permissions.find(
			(item) => item.id === permissionId,
		);
		if (!permission) {
			throw new RemoteError("stale_approval");
		}
		const offered = remoteApproval(permission).options.some(
			(option) => option.id === optionId,
		);
		if (!offered) {
			throw new RemoteError("forbidden");
		}
		return {
			type: "permission/respond",
			sessionId,
			runId,
			requestId,
			permissionId,
			optionId,
		};
	}
}
