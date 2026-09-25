// App Server の起動・初期化をまとめ、初期化済み接続だけを呼び出し側へ渡す。
import type { ClientInfo } from "./codex-app-server/ClientInfo";
import type { CommandExecParams } from "./codex-app-server/v2/CommandExecParams";
import type { WindowsSandboxImplementation } from "../../security/AgentAccessPolicy";
import type { InitializeResponse } from "./codex-app-server/InitializeResponse";
import type { CollaborationMode } from "./codex-app-server/CollaborationMode";
import type { ThreadLoadedListParams } from "./codex-app-server/v2/ThreadLoadedListParams";
import type { ThreadStartParams } from "./codex-app-server/v2/ThreadStartParams";
import type {
	ContextTurnStartParams,
	ContextTurnSteerParams,
} from "./context/additionalContext";
import type { LoginAccountParams } from "./codex-app-server/v2/LoginAccountParams";
import type { ThreadListParams } from "./codex-app-server/v2/ThreadListParams";
import {
	AppServerTransport,
	type AppServerCallbacks,
} from "./runtime/AppServerTransport";
import { startAppServerProcess } from "./runtime/AppServerProcess";
import { resolveCodexExecutable } from "./runtime/executable";
import { PersonalityStore } from "./settings/PersonalityStore";
import {
	composeDeveloperInstructions,
	type PersonalityMessage,
} from "../../../shared/personality";

/** Extension Host が確定したローカル起動条件。 */
export type CodexClientOptions = {
	extensionPath: string;
	cwd: string;
	clientInfo: ClientInfo;
	callbacks?: AppServerCallbacks;
	signal?: AbortSignal;
	/** 専用シェル接続だけが指定し、既存 Codex バックエンドの設定継承は維持する。 */
	windowsSandbox?: WindowsSandboxImplementation;
	/** 実行側で停止・終了を管理する場合は、初期化後に接続用の取消リスナーを外す。 */
	connectAbortOnly?: boolean;
};

/** 初期化済みの型付き RPC を、機能別の操作として提供する。 */
export class CodexClient {
	/** 初期化が完了した Transport とサーバー情報を保持する。 */
	private constructor(
		private readonly transport: AppServerTransport,
		readonly serverInfo: InitializeResponse,
		private readonly detachAbort: () => void,
		private readonly personality: PersonalityStore,
	) {}

	/** initialize の成功後に initialized を送り、失敗時は起動したプロセスを回収する。 */
	static async connect(options: CodexClientOptions): Promise<CodexClient> {
		const executable = await resolveCodexExecutable(options.extensionPath);
		options.signal?.throwIfAborted();
		const transport = new AppServerTransport(
			startAppServerProcess(
				executable,
				options.cwd,
				options.windowsSandbox,
			),
			options.callbacks,
		);
		/** 初期化待ちでもワークスペース変更・拡張機能終了に追従する。 */
		const abort = () => {
			void transport.dispose();
		};
		options.signal?.addEventListener("abort", abort, { once: true });
		const detachAbort = () =>
			options.signal?.removeEventListener("abort", abort);
		try {
			const response = await transport.request("initialize", {
				clientInfo: options.clientInfo,
				capabilities: {
					// セッション参照と `collaborationMode` に必要な試験的 API を有効化する。
					experimentalApi: true,
					requestAttestation: false,
				},
			});
			transport.notify({ method: "initialized" });
			options.signal?.throwIfAborted();
			if (options.connectAbortOnly) {
				detachAbort();
			}
			return new CodexClient(
				transport,
				response,
				detachAbort,
				new PersonalityStore(options.cwd),
			);
		} catch (error) {
			detachAbort();
			await transport.dispose();
			throw error;
		}
	}
	/** 信頼済み `project` 層を含む、Codex の実効 Windows 設定を取得する。 */
	readSandboxConfig(cwd: string) {
		return this.transport.request("config/read", {
			cwd,
			includeLayers: false,
		});
	}
	/** `readiness` は実行基盤の準備状態で、通信遮断の実測ではない。 */
	readSandboxReadiness() {
		return this.transport.request("windowsSandbox/readiness", undefined);
	}
	/** 明示的な VS Code コマンドからだけセットアップを開始する。 */
	setupWindowsSandbox(cwd: string, mode: WindowsSandboxImplementation) {
		return this.transport.request("windowsSandbox/setupStart", {
			cwd,
			mode,
		});
	}
	/** thread・モデル認証を作らず、承認済み `argv` をサンドボックス内で実行する。 */
	executeCommand(params: CommandExecParams) {
		return this.transport.request(
			"command/exec",
			params,
			(params.timeoutMs ?? 60_000) + 10_000,
		);
	}
	/** 接続内の特定 `command` だけを停止する。 */
	terminateCommand(processId: string) {
		return this.transport.request(
			"command/exec/terminate",
			{ processId },
			2_000,
		);
	}
	/** 既存の認証状態だけを調べる。 */
	readAccount() {
		return this.transport.request("account/read", {});
	}
	/** `cwd` とアーカイブ状態を指定して一覧の一ページを取得する。 */
	listThreads(params: ThreadListParams) {
		return this.transport.request("thread/list", params);
	}
	/** 通常はメタデータだけを読み、参照の取得時だけ本文も要求する。 */
	readThread(threadId: string, includeTurns = false) {
		return this.transport.request("thread/read", {
			threadId,
			includeTurns,
		});
	}
	/** 最新の性格設定を適用し、その他の保存済み設定を維持して再開する。 */
	async resumeThread(threadId: string, excludeTurns = false) {
		return this.transport.request("thread/resume", {
			developerInstructions: composeDeveloperInstructions(
				await this.personality.read(),
			),
			threadId,
			excludeTurns,
		});
	}
	/** 元の会話を変更せず、新しいスレッドへ分岐する。 */
	async forkThread(threadId: string, excludeTurns = false) {
		return this.transport.request("thread/fork", {
			developerInstructions: composeDeveloperInstructions(
				await this.personality.read(),
			),
			threadId,
			excludeTurns,
		});
	}
	/** 古いターンから順に、全項目を指定して取得する。 */
	listTurns(threadId: string, cursor?: string) {
		return this.transport.request("thread/turns/list", {
			threadId,
			sortDirection: "asc",
			itemsView: "full",
			limit: 50,
			...(cursor ? { cursor } : {}),
		});
	}
	/** ターン本文が省略された場合に項目をページ取得する。 */
	listItems(threadId: string, turnId: string, cursor?: string) {
		return this.transport.request("thread/items/list", {
			threadId,
			turnId,
			sortDirection: "asc",
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
	}
	/** 会話名は Codex 側へ保存する。 */
	renameThread(threadId: string, name: string) {
		return this.transport.request("thread/name/set", { threadId, name });
	}
	/** 指定した会話の削除を App Server に要求する。 */
	deleteThread(threadId: string) {
		return this.transport.request("thread/delete", { threadId });
	}
	/** 会話をアーカイブする。 */
	archiveThread(threadId: string) {
		return this.transport.request("thread/archive", { threadId });
	}
	/** 保存された会話を通常の一覧へ戻す。 */
	unarchiveThread(threadId: string) {
		return this.transport.request("thread/unarchive", { threadId });
	}
	/** 作業フォルダーで利用可能なスキルを取得する。 */
	listSkills(cwd: string) {
		return this.transport.request("skills/list", { cwds: [cwd] });
	}
	/** 現在のスレッドのツールと認証状態に限定して MCP 一覧を取得する。 */
	listMcpServerStatus(threadId: string, cursor?: string) {
		return this.transport.request("mcpServerStatus/list", {
			detail: "toolsAndAuthOnly",
			threadId,
			...(cursor === undefined ? {} : { cursor }),
		});
	}
	/** 利用可能モデルのページを取得する。 */
	listModels(cursor?: string) {
		return this.transport.request("model/list", {
			...(cursor ? { cursor } : {}),
		});
	}
	/** 既存 UI が表示する利用枠を取得する。 */
	readRateLimits() {
		return this.transport.request("account/rateLimits/read", {});
	}
	/** 認証情報は Host 内の要求だけに使用する。 */
	login(params: LoginAccountParams) {
		return this.transport.request("account/login/start", params);
	}
	/** 開始したログインを取消す。 */
	cancelLogin(loginId: string) {
		return this.transport.request("account/login/cancel", { loginId });
	}
	/** 保存済みの認証を App Server 経由で解除する。 */
	logout() {
		return this.transport.request("account/logout", undefined);
	}
	/** ワークスペースと Codex の既存設定を使って会話を開始する。 */
	async startThread(params: ThreadStartParams) {
		return this.transport.request("thread/start", {
			...params,
			developerInstructions: composeDeveloperInstructions(
				await this.personality.read(),
			),
		});
	}
	/** UI 表示用に設定を取得する。 */
	readPersonality() {
		return this.personality.read();
	}
	/** プリセットの選択・保存を Host 側の固定パスへ反映する。 */
	changePersonality(
		message: Exclude<PersonalityMessage, { type: "personality/read" }>,
	) {
		return this.personality.change(message);
	}
	/** 1つのターンを開始し、開始受付の応答を返す。 */
	startTurn(params: ContextTurnStartParams) {
		return this.transport.request("turn/start", params);
	}
	/** Plan を終了するときは、待機中のスレッドにも Default を反映する。 */
	updateCollaborationMode(
		threadId: string,
		collaborationMode: CollaborationMode,
	) {
		return this.transport.request("thread/settings/update", {
			threadId,
			collaborationMode,
		});
	}
	/** 実行中のターンへ追加指示を送り、受付を確認する。 */
	steerTurn(params: ContextTurnSteerParams) {
		return this.transport.request("turn/steer", params);
	}
	/** 指定した会話の実行中ターンへ停止を要求する。 */
	interruptTurn(threadId: string, turnId: string) {
		return this.transport.request("turn/interrupt", { threadId, turnId });
	}

	/** 会話を作らず、初期化後の要求が受け付けられることを確認する。 */
	listLoadedThreads(params: ThreadLoadedListParams = {}) {
		return this.transport.request("thread/loaded/list", params);
	}

	/** 接続と子プロセスの終了を待つ。 */
	dispose(): Promise<void> {
		this.detachAbort();
		return this.transport.dispose();
	}
}
