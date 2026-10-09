// 検証済みの Webview 操作を、現在の thread とローカル実行 ID に限定する。
import type { AppServerNotification } from "./protocol/rpcMessage";
import { executeBackend } from "../../session/BackendExecution";
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { RequestDeduplicator } from "../../session/RequestDeduplicator";
import type { UiMessage } from "@nerita/shared/messages";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { CodexSubmission } from "./CodexSubmission";
import { CodexRun } from "./CodexRun";
import { CodexLifecycle } from "./CodexLifecycle";
import { SessionState } from "../../session/sessionState";
import type { ChatState } from "@nerita/shared/chatState";
import { CodexCatalog } from "./CodexCatalog";
import { CodexHistory, type RestoredHistory } from "./CodexHistory";
import { CodexRequests } from "./CodexRequests";
import { CodexAgents } from "./CodexAgents";
import { CodexOptions } from "./CodexOptions";
import { CodexAttachments } from "./CodexAttachments";
import type { CodexFactory } from "./runtime/connection";
import type { AttachmentService } from "../../session/attachmentService";
import type { AuthService } from "./interaction/AuthFlow";
import type { InteractionService } from "./interaction/interactionService";
import type { CodexSelectionStore } from "./settings/modelSelection";
import { isRecord } from "@nerita/shared/validation";
import type { StartedThread } from "./protocol/turn";
import {
	searchSessionReferences,
	openSessionReference,
} from "./context/sessionReferenceActions";
import { SessionContextError } from "./context/sessionContext";
import { ChangeContextError } from "./context/changeContext";
import { openChanges } from "./context/openChanges";
import { CodeReferenceError } from "../../session/codeReferenceContext";
import { HandoffContextError } from "../../session/HandoffContext";
import {
	type SessionReferencesRequest,
	type SessionReferenceOpen,
} from "@nerita/shared/sessionReferences";

/** 送信・停止・承認・接続・履歴操作を公開する。 */
export class CodexSessionController extends SessionState {
	private requests = new RequestDeduplicator();
	private readonly options: CodexOptions;
	private readonly serverRequests: CodexRequests;
	private readonly attachments: CodexAttachments;
	private readonly submission: CodexSubmission;
	private readonly run: CodexRun;
	private readonly lifecycle: CodexLifecycle;
	/** 機能別の協調オブジェクトへ現在値の取得を渡し、会話状態と接続をここで共有する。 */
	constructor(
		factory: CodexFactory,
		files?: AttachmentService,
		auth?: AuthService,
		interactions?: InteractionService,
		selectionStore?: CodexSelectionStore,
	) {
		super();
		const stateAccess = {
			snapshot: () => this.state,
			busy: () => this.busy(),
			patch: (change: Partial<ChatState>) => this.patch(change),
		};
		this.lifecycle = new CodexLifecycle(
			{
				...stateAccess,
				notification: (message) => this.notification(message),
				request: (message, signal) =>
					this.serverRequests.request(message, signal),
				resetRun: () => {
					this.run.reset();
					this.execution.fail(
						new Error("Codex の内部実行が中断されました。"),
					);
				},
				initializedThread: (thread) => this.initializedThread(thread),
			},
			factory,
			auth,
		);
		const session = {
			...stateAccess,
			connection: () => this.lifecycle.connection,
			epoch: () => this.lifecycle.generation,
		};
		this.serverRequests = new CodexRequests(
			{ ...stateAccess, active: () => this.run.current },
			interactions,
		);
		this.options = new CodexOptions(session, selectionStore);
		this.attachments = new CodexAttachments(session, files);
		this.run = new CodexRun(
			{
				...session,
				finished: (status) => this.execution.finish(status),
				failConnection: (message) =>
					this.lifecycle.failConnection(message),
			},
			this.options,
			this.agents,
		);
		this.submission = new CodexSubmission(
			{
				...session,
				active: () => this.run.current,
				prompt: (text, context, references) =>
					this.run.prompt(text, context, references),
				prepareAttachments: (selected) =>
					this.run.prepareAttachments(selected),
			},
			this.options,
			factory,
		);
	}

	/** 接続の終了待ちと世代の照合は、接続処理へまとめて委ねる。 */
	connect(): Promise<void> {
		return this.lifecycle.connect();
	}
	/** 内部入力はスラッシュコマンド・追加指示・チャット用通信を通さず送信する。 */
	async execute(text: string, signal: AbortSignal) {
		if (
			this.busy() ||
			this.state.connection !== "ready" ||
			this.state.configPending ||
			this.state.sessionPending
		) {
			throw new Error("Codex の内部実行を開始できません。");
		}
		return executeBackend(
			this.execution,
			() => this.run.prompt(text),
			() => this.cancel(),
			signal,
		);
	}
	cancelExecution(): void {
		this.cancel();
	}

	/** ワークスペース変更時の接続取消しと実行解除を同じ経路へ通す。 */
	invalidate(): void {
		this.lifecycle.invalidate();
	}

	/** 接続の終了処理を始めてから UI の購読と全文出力を解除し、接続の回収完了まで待つ。 */
	async dispose(): Promise<void> {
		const closing = this.lifecycle.dispose();
		this.clearListeners();
		await closing;
	}

	/** 送信準備を先に取り消してから、親ターンを停止する。 */
	private cancel(): void {
		this.submission.cancel();
		this.run.cancel();
	}

	/** 管理画面には設定オブジェクトが取得したモデル別の推論候補を公開する。 */
	agentModels() {
		return this.options.agentModels();
	}
	private readonly catalog = new CodexCatalog({
		snapshot: () => this.state,
		connection: () => this.lifecycle.connection,
		epoch: () => this.lifecycle.generation,
		patch: (change) => this.patch(change),
		clearThread: () => this.clearUnavailableThread(),
	});
	private readonly agents = new CodexAgents({
		snapshot: () => this.state,
		connection: () => this.lifecycle.connection,
		epoch: () => this.lifecycle.generation,
		patch: (change) => this.patch(change),
		publishView: (message, outputs) => this.emit(message, outputs),
		publishStopped: (message) => this.emit(message),
	});
	private readonly history = new CodexHistory(
		{
			snapshot: () => this.state,
			connection: () => this.lifecycle.connection,
			epoch: () => this.lifecycle.generation,
			busy: () => this.busy(),
			patch: (change) => this.patch(change),
			clearThread: () => this.clearUnavailableThread(true),
			restoreThread: (restored, current) =>
				this.restoreHistory(restored, current),
		},
		this.catalog,
	);

	/** 本文と全文出力を同時に引き継ぎ、設定初期化を終えた同じ会話の子だけを同期する。 */
	private async restoreHistory(
		restored: RestoredHistory,
		current: () => boolean,
	): Promise<void> {
		const { result, display } = restored;
		if (!current()) {
			display.outputs.dispose();
			return;
		}
		this.run.reset();
		this.patch(
			{
				...display.state,
				sessionId: result.thread.id,
				sessionTitle:
					nonEmptyString(result.thread.name?.trim()) ??
					nonEmptyString(result.thread.preview) ??
					null,
				runId: null,
				run: "idle",
				permissions: [],
				asyncTasks: [],
				attachments: [],
				usage: null,
				configOptions: [],
				error: null,
			},
			display.outputs,
		);
		await this.options.initialize(result, false);
		if (current() && this.state.sessionId === result.thread.id) {
			this.agents.synchronize();
		}
	}

	/** 新規会話は設定を先に初期化し、同じ接続の一覧だけを公開する。 */
	private async initializedThread(thread: StartedThread): Promise<void> {
		const epoch = this.lifecycle.generation;
		await this.options.initialize(thread);
		if (epoch === this.lifecycle.generation) {
			this.patch({
				attachmentsSupported: this.attachments.supportsAttachments,
			});
			await this.catalog.initialize();
		}
	}

	/** 外部通知では本文を残し、利用者の履歴操作で削除・アーカイブした場合は内容も消す。 */
	private clearUnavailableThread(clearContents = false): void {
		this.run.reset();
		this.patch({
			sessionId: null,
			runId: null,
			run: "idle",
			permissions: [],
			attachments: [],
			configOptions: [],
			usage: null,
			...(clearContents
				? { messages: [], tools: [], asyncTasks: [] }
				: {}),
		});
	}

	/** 履歴の競合、設定、子、親ターン、一覧の順を明示し、通知の順序をここで管理する。 */
	private notification(message: AppServerNotification): void {
		this.history.notification(message);
		this.options.notification(message);
		this.childrenNotification(message);
		this.run.notification(message);
		this.catalog.notification(message);
	}

	/** 親の項目はターン処理で待機・再生し、子の通知は親ターンの絞り込み前に届ける。 */
	private childrenNotification(message: AppServerNotification): void {
		if (
			isRecord(message.params) &&
			message.params.threadId === this.state.sessionId &&
			(message.method === "turn/completed" ||
				(this.run.current &&
					["item/started", "item/completed"].includes(
						message.method,
					)))
		) {
			return;
		}
		this.agents.notification(message);
	}

	/** 二重要求と古い UI の操作を排除して、失敗は要求元へ通知する。 */
	async receive(value: unknown): Promise<void> {
		if (!isUiMessage(value)) {
			return;
		}
		if (value.type === "ui/ready") {
			this.emit({ type: "state/snapshot", state: this.snapshot() });
			return;
		}
		if (!this.requests.accept(value.requestId)) {
			return;
		}
		try {
			await this.dispatch(value);
		} catch (error) {
			this.emit({
				type: "request/failed",
				requestId: value.requestId,
				error: requestError(value.type, error),
			});
		}
	}
	/** 操作範囲と実行状態を照合してから、対象の処理へ渡す。 */
	private async dispatch(
		message: Exclude<UiMessage, { type: "ui/ready" }>,
	): Promise<void> {
		if (message.type === "tool/output") {
			await this.readToolOutput(message);
			return;
		}
		if (message.type === "agent/read") {
			await this.agents.read(message);
			return;
		}
		if (message.type === "agent/stop") {
			await this.agents.stop(message);
			return;
		}
		if (message.type === "changes/open") {
			await this.openRequestedChanges(message);
			return;
		}
		if (
			message.type === "session/searchReferences" ||
			message.type === "session/openReference"
		) {
			await this.sessionReferenceAction(message);
			return;
		}
		if (
			message.type === "personality/read" ||
			message.type === "personality/save" ||
			message.type === "personality/select"
		) {
			await this.personalityAction(message);
			return;
		}
		await this.dispatchMutableAction(message);
	}

	/** 更新待ちを排除して認証・接続操作を処理する。 */
	private async dispatchMutableAction(message: UiMessage): Promise<void> {
		if (
			this.submission.pending &&
			![
				"prompt/send",
				"prompt/cancel",
				"execution/stop",
				"permission/respond",
			].includes(message.type)
		) {
			throw new Error("Submission pending");
		}
		if (this.state.sessionPending || this.state.configPending) {
			throw new Error("Session pending");
		}
		if (message.type === "connection/retry") {
			if (this.busy() || this.state.connection === "connecting") {
				throw new Error("Busy");
			}
			await this.connect();
			return;
		}
		if (message.type === "auth/start") {
			await this.lifecycle.authenticate(message.methodId);
			return;
		}
		if (this.state.connection !== "ready") {
			throw new Error("Disconnected");
		}
		await this.dispatchReadyAction(message);
	}

	/** 接続済みの会話操作と履歴操作を振り分ける。 */
	private async dispatchReadyAction(message: UiMessage): Promise<void> {
		if (message.type === "plan/decide") {
			await this.decidePlan(message);
			return;
		}
		if (message.type === "session/new") {
			await this.lifecycle.newThread();
			return;
		}
		if (message.type === "auth/logout") {
			await this.lifecycle.logout();
			return;
		}
		if (message.type === "session/list") {
			await this.catalog.refresh(message.archived, message.more);
			return;
		}
		if (isHistoryAction(message)) {
			const action = (
				{
					"session/load": "load",
					"session/fork": "fork",
					"session/delete": "delete",
					"session/archive": "archive",
					"session/rename": "rename",
					"session/unarchive": "unarchive",
				} as const
			)[message.type];
			await this.history.manage(
				action,
				message.sessionId,
				message.type === "session/rename" ? message.name : undefined,
			);
			return;
		}
		await this.dispatchThreadAction(message);
	}

	/** 表示中の Plan だけを対象に、モード変更から送信までを処理する。 */
	private async decidePlan(
		message: Extract<UiMessage, { type: "plan/decide" }>,
	) {
		const decision = this.state.planDecision;
		if (
			!decision ||
			message.sessionId !== this.state.sessionId ||
			message.runId !== decision.runId ||
			this.busy()
		) {
			throw new Error("Stale plan");
		}
		if (message.action === "continue") {
			this.patch({ planDecision: null });
			return;
		}
		const plan = decision.text;
		if (message.action === "new") {
			const settings = this.options.capturePlanSettings();
			await this.lifecycle.newThread();
			await this.options.restorePlanSettings(settings);
		} else {
			await this.options.setConfig("collaboration_mode", "default");
		}
		this.patch({ planDecision: null });
		const text =
			message.action === "new"
				? `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\n${plan}`
				: plan;
		await this.submission.submitPrompt(text, this.state.sessionId);
	}

	/** 操作対象が現在の会話であることを確認する。 */
	private async dispatchThreadAction(message: UiMessage): Promise<void> {
		if (
			!("sessionId" in message) ||
			message.sessionId !== this.state.sessionId
		) {
			throw new Error("Stale thread");
		}
		if (message.type === "prompt/send") {
			return this.sendPromptAction(message);
		}
		if (message.type === "config/set") {
			await this.options.setConfig(message.configId, message.value);
			await this.options.rememberSelection(message.configId);
			return;
		}
		if (
			message.type === "attachment/add" ||
			message.type === "attachment/open" ||
			message.type === "attachment/remove"
		) {
			await this.attachments.attachment(message);
			return;
		}
		this.runningAction(message);
	}

	/** 接続中の性格設定を読み取りまたは変更する。 */
	private async personalityAction(
		message: Extract<
			UiMessage,
			{
				type:
					| "personality/read"
					| "personality/select"
					| "personality/save";
			}
		>,
	) {
		const client = this.lifecycle.connection;
		const epoch = this.lifecycle.generation;
		if (!client?.readPersonality || !client.changePersonality) {
			throw new Error("接続後に設定を開いてください。");
		}
		const personality =
			message.type === "personality/read"
				? await client.readPersonality()
				: await client.changePersonality(message);
		if (epoch === this.lifecycle.generation) {
			this.patch({ personality });
		}
		return;
	}

	/** 参照候補の検索と会話表示を同じ接続世代で実行する。 */
	private async sessionReferenceAction(
		message: SessionReferencesRequest | SessionReferenceOpen,
	) {
		const client = this.lifecycle.connection;
		const cwd = this.state.cwd;
		const id = this.state.sessionId;
		const epoch = this.lifecycle.generation;
		if (
			!client ||
			!isNonEmptyString(cwd) ||
			!isNonEmptyString(id) ||
			this.state.connection !== "ready"
		) {
			throw new Error("Disconnected");
		}
		const current = () =>
			epoch === this.lifecycle.generation && id === this.state.sessionId;
		if (message.type === "session/searchReferences") {
			const result = await searchSessionReferences(
				client,
				cwd,
				id,
				message,
				current,
			);
			if (current()) {
				this.emit(result);
			}
		} else {
			await openSessionReference(client, cwd, message, current);
		}
		return;
	}

	/** 現在の接続と会話に限定して差分を開く。 */
	private async openRequestedChanges(
		message: Extract<UiMessage, { type: "changes/open" }>,
	) {
		const { cwd, sessionId } = this.state;
		const epoch = this.lifecycle.generation;
		if (
			!isNonEmptyString(cwd) ||
			!isNonEmptyString(sessionId) ||
			this.state.connection !== "ready"
		) {
			throw new Error("Disconnected");
		}
		await openChanges(
			cwd,
			message.scope,
			() =>
				epoch === this.lifecycle.generation &&
				sessionId === this.state.sessionId,
		);
		return;
	}

	/** 入力欄のコマンドと通常送信を処理する。 */
	private async sendPromptAction(
		message: Extract<UiMessage, { type: "prompt/send" }>,
	): Promise<void> {
		const command = /^\/(plan)(?:\s([\s\S]*))?$/u.exec(message.text.trim());
		if (command) {
			this.assertSubmissionIdle();
			if (this.options.mode !== command[1]) {
				await this.options.setConfig("collaboration_mode", command[1]!);
			}
			if (!isNonEmptyString(command[2]?.trim())) {
				this.emit({
					type: "prompt/accepted",
					requestId: message.requestId,
					mode: "start",
				});
				return;
			}
			// /plan 自体はモデルへの指示にせず、本文だけで計画ターンを開始する。
			if (command[1] === "plan") {
				message = { ...message, text: command[2].trimStart() };
			}
		}
		if (message.text.trim() === "/logout") {
			this.assertSubmissionIdle();
			await this.lifecycle.logout();
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		if (message.text.trim() === "/mcp") {
			await this.submission.showMcpStatus(message.sessionId);
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		if (message.text.trim() === "/new") {
			this.assertSubmissionIdle();
			await this.lifecycle.newThread();
			this.emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		const mode = await this.submission.submitPrompt(
			message.text,
			message.sessionId,
			message.sessionReferences,
			message.changeScopes,
			message.codeReferences,
			message.references,
		);
		this.emit({
			type: "prompt/accepted",
			requestId: message.requestId,
			mode,
		});
		return;
	}

	/** 送信準備中の会話切り替えを禁止する。 */
	private assertSubmissionIdle() {
		if (this.submission.pending) {
			throw new Error("Submission pending");
		}
	}

	/** 現在の実行に対する停止と承認操作を処理する。 */
	private runningAction(message: UiMessage): void {
		if (
			!("runId" in message) ||
			message.runId !== this.state.runId ||
			!this.busy()
		) {
			throw new Error("Stale run");
		}
		if (message.type === "prompt/cancel") {
			this.cancel();
			return;
		}
		if (message.type === "execution/stop") {
			this.assertCurrentTool(message);
			this.cancel();
			return;
		}
		if (
			message.type === "permission/respond" &&
			this.state.run === "running" &&
			this.serverRequests.respond(message.permissionId, message.optionId)
		) {
			if (message.optionId === "cancel") {
				this.cancel();
			}
			return;
		}
		throw new Error("Unsupported action");
	}

	/** 停止要求のツールが現在の実行に含まれるか照合する。 */
	private assertCurrentTool(
		message: Extract<UiMessage, { type: "execution/stop" }>,
	) {
		if (
			!this.state.tools.some(
				(tool) =>
					tool.id === message.toolId &&
					tool.runId === message.runId &&
					["pending", "in_progress"].includes(tool.status),
			)
		) {
			throw new Error("Stale tool");
		}
	}
}

/** 参照の詳細エラーを優先し、操作に応じた復旧方法を返す。 */
function requestError(type: UiMessage["type"], error: unknown) {
	if (
		error instanceof SessionContextError ||
		error instanceof HandoffContextError ||
		error instanceof ChangeContextError ||
		error instanceof CodeReferenceError
	) {
		return error.message;
	}
	if (type.startsWith("personality/") && error instanceof Error) {
		return `性格設定を読み込み・保存できませんでした: ${error.message}`;
	}
	if (type === "prompt/send") {
		return "送信できませんでした。接続を確認して再試行してください。";
	}
	return "現在の状態では操作できません。接続状態を確認してください。";
}

/** 会話 ID を指定して保存履歴を変更する操作を識別する。 */
function isHistoryAction(message: UiMessage): message is Extract<
	UiMessage,
	{
		type:
			| "session/load"
			| "session/fork"
			| "session/delete"
			| "session/archive"
			| "session/rename"
			| "session/unarchive";
	}
> {
	return [
		"session/load",
		"session/fork",
		"session/delete",
		"session/archive",
		"session/rename",
		"session/unarchive",
	].includes(message.type);
}
