// 表示先とコマンドの接続先を保持し、バックエンドの終了・再生成を管理する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { WorkflowExecution } from "@nerita/shared/workflows/messages";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import type { BackendSession } from "./chatSession";
import type { BackendId } from "@nerita/shared/backend";
import {
	DlcUiMessageSchema,
	type DlcUiMessage,
} from "@nerita/shared/dlc/contracts";
import type { BackendExecutionResult } from "./BackendExecution";
import { ToolOutputStore } from "./ToolOutputStore";
import type { DlcSessionOwnership } from "./DlcSessionOwnership";

type DlcSession = {
	intentId: string;
	attemptId: string;
	session: BackendSession;
	abort: AbortController;
	approvals: {
		requestId: string;
		optionId: string;
		kind: "allow" | "deny" | "abort";
	}[];
	operation: Promise<BackendExecutionResult>;
	finished?: Promise<void>;
	unsubscribe: () => void;
};

/** 旧接続の終了を待ち、購読を新しいセッションへ引き継ぐ。 */
export class BackendRuntime implements BackendSession {
	private current: BackendSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private listeners = new Set<(event: HostMessage) => void>();
	private revision = 0;
	private restarting: Promise<void> | undefined;
	private closing: Promise<void> | undefined;
	private disposed = false;
	private error: string | null = null;
	private mode: "chat" | "dlc" = "chat";
	private selectedIntent: string | undefined;
	private dlcSession: DlcSession | undefined;
	private managedSessionIds = new Set<string>();
	private history = new Map<string, ChatState>();
	private prompts = new Map<string, string>();
	private latestAttempts = new Map<string, string>();
	private records = new Map<string, ChatState>();
	private shownAttempt: string | undefined;
	private historyOutputs = new ToolOutputStore();
	private dlcHandler: ((message: DlcUiMessage) => Promise<void>) | undefined;

	/** 再生成時に最新の設定を取得する関数を保持する。 */
	constructor(
		private readonly factory: (backend?: BackendId) => BackendSession,
		private readonly ownership?: DlcSessionOwnership,
	) {
		this.attach(factory());
	}

	/** 表示先で継続する更新番号を付けて状態を取得する。 */
	snapshot() {
		const state =
			this.mode === "dlc"
				? this.dlcSnapshot()
				: (this.current?.snapshot() ?? initialState());
		return {
			...state,
			...(!this.current ? { connection: "connecting" as const } : {}),
			...(isNonEmptyString(this.error)
				? { connection: "error" as const, error: this.error }
				: {}),
			revision: this.revision,
		};
	}

	/** セッションを交換しても表示先の購読を維持する。 */
	subscribe(listener: (event: HostMessage) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 切替中の要求を拒否し、生成失敗後は再接続で復旧できるようにする。 */
	async receive(value: unknown): Promise<void> {
		if (this.disposed) {
			return;
		}
		if (isUiMessage(value) && (await this.routeDlc(value))) {
			return;
		}
		if (this.restarting) {
			this.rejectSwitching(value);
			return;
		}
		if (
			!this.current &&
			isUiMessage(value) &&
			value.type === "connection/retry"
		) {
			await this.restart();
			return;
		}
		this.error = null;
		await this.current?.receive(value);
	}

	/** 現在のバックエンドが公開するモデル候補だけを管理画面へ渡す。 */
	private rejectSwitching(value: unknown): void {
		if (isUiMessage(value) && "requestId" in value) {
			this.emit({
				type: "request/failed",
				requestId: value.requestId,
				error: "バックエンドを切り替えています。完了後に再試行してください。",
			});
		}
	}
	private async routeDlc(value: UiMessage): Promise<boolean> {
		const dlc = DlcUiMessageSchema.safeParse(value);
		if (dlc.success) {
			await this.dlcHandler?.(dlc.data);
			return true;
		}
		if (value.type === "tool/output" && this.mode === "dlc") {
			await this.dlcOutput(value);
			return true;
		}
		if (await this.routeManaged(value)) {
			return true;
		}
		if (
			this.mode === "dlc" &&
			[
				"prompt/send",
				"connection/retry",
				"session/new",
				"session/load",
				"session/fork",
				"plan/decide",
				"permission/respond",
				"prompt/cancel",
			].includes(value.type)
		) {
			throw new Error("現在の Intent と実行を選択して操作してください。");
		}
		return false;
	}
	private rememberOwnership(sessionId: string | null | undefined): void {
		if (isNonEmptyString(sessionId)) {
			this.managedSessionIds.add(sessionId);
			this.ownership?.remember(sessionId);
		}
	}
	private async routeManaged(value: UiMessage): Promise<boolean> {
		const active = this.dlcSession;
		this.rememberOwnership(active?.session.snapshot().sessionId);
		if (
			active &&
			"sessionId" in value &&
			value.sessionId === active.session.snapshot().sessionId
		) {
			await this.routeDlcSession(active, value);
			return true;
		}
		// 表示モードを戻しても、終了・復元済みの DLC 会話へ手動ターンを追加させない。
		if (
			"sessionId" in value &&
			(this.managedSessionIds.has(value.sessionId) ||
				this.ownership?.has(value.sessionId) === true)
		) {
			throw new Error(
				"この DLC セッションへの操作は、対象の実行が終了したため受け付けられません。",
			);
		}
		return false;
	}
	private async dlcOutput(
		value: Extract<UiMessage, { type: "tool/output" }>,
	): Promise<void> {
		const active = this.dlcSession;
		if (
			active?.session
				.snapshot()
				.tools.some(
					(tool) => tool.output?.outputRef === value.outputRef,
				) === true
		) {
			await active.session.receive(value);
		} else {
			this.emit(await this.historyOutputs.read(value));
		}
	}
	private async routeDlcSession(
		active: DlcSession,
		value: UiMessage,
	): Promise<void> {
		if (value.type === "permission/respond") {
			await this.dlcPermission(active, value);
			return;
		}
		if (value.type === "prompt/cancel") {
			if (active.session.snapshot().runId !== value.runId) {
				throw new Error("この実行は既に終了しています。");
			}
			await this.dlcHandler?.({
				type: "dlc/action",
				requestId: value.requestId,
				intentId: active.intentId,
				revision: -1,
				action: { type: "cancel" },
			});
			return;
		}
		if (value.type === "execution/stop" || value.type === "agent/read") {
			await active.session.receive(value);
			return;
		}
		throw new Error("DLC の実行中に会話の入力や設定を変更できません。");
	}
	private async dlcPermission(
		active: DlcSession,
		value: Extract<UiMessage, { type: "permission/respond" }>,
	): Promise<void> {
		const state = active.session.snapshot();
		const permission = state.permissions.find(
			(item) => item.id === value.permissionId,
		);
		const option = permission?.options.find(
			(item) => item.id === value.optionId,
		);
		if (state.runId !== value.runId || !option || !permission) {
			throw new Error("この承認要求は現在の実行に属していません。");
		}
		await active.session.receive(value);
		if (
			!active.session
				.snapshot()
				.permissions.some((item) => item.id === value.permissionId)
		) {
			active.approvals.push({
				requestId: permission.id,
				optionId: option.id,
				kind: option.kind,
			});
		}
	}
	agentModels() {
		return (
			this.current?.agentModels?.() ??
			this.snapshot().configOptions.find((item) => item.id === "model")
				?.options ??
			[]
		);
	}
	/** エディタの実行を現在のバックエンドへ限定する。 */
	async workflow(request: WorkflowExecution, signal: AbortSignal) {
		if (this.disposed || this.restarting || !this.current?.workflow) {
			throw new Error("Pi バックエンドへ接続してください。");
		}
		return this.current.workflow(request, signal);
	}
	/** 同時に届いた切替要求を1つにまとめる。 */
	restart(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		this.restarting ??= this.replace().finally(() => {
			this.restarting = undefined;
		});
		return this.restarting;
	}

	/** ワークスペースの変更を現在の接続へ伝える。 */
	invalidate(): void {
		this.current?.invalidate();
		this.dlcSession?.abort.abort();
		this.dlcSession?.session.invalidate();
	}

	setDlcHandler(handler: (message: DlcUiMessage) => Promise<void>): void {
		this.dlcHandler = handler;
	}
	viewMode(): "chat" | "dlc" {
		return this.mode;
	}
	selectDlc(intentId: string | undefined): void {
		this.selectedIntent = intentId;
		this.shownAttempt =
			this.dlcSession?.intentId === intentId
				? undefined
				: this.latestAttempts.get(intentId ?? "");
		this.emit({ type: "state/snapshot", state: this.snapshot() });
	}
	selectMode(mode: "chat" | "dlc"): void {
		this.mode = mode;
		this.emit({ type: "state/snapshot", state: this.snapshot() });
	}
	publish(event: HostMessage): void {
		this.emit(event);
	}
	activeDlc(): { intentId: string; attemptId: string } | null {
		const active = this.dlcSession;
		return active
			? { intentId: active.intentId, attemptId: active.attemptId }
			: null;
	}
	busy(): boolean {
		const state = this.current?.snapshot();
		return (
			this.dlcSession !== undefined ||
			state?.run === "running" ||
			state?.run === "cancelling"
		);
	}
	showAttempt(
		intentId: string,
		attemptId: string,
		state: ChatState,
		prompt: string,
	): void {
		if (this.selectedIntent !== intentId) {
			throw new Error("Intent が変更されています。");
		}
		this.rememberOwnership(state.sessionId);
		this.history.set(
			`${intentId}:${attemptId}`,
			this.projectConversation(state),
		);
		this.shownAttempt = attemptId;
		this.prompts.set(`${intentId}:${attemptId}`, prompt);
		this.emit({ type: "state/snapshot", state: this.snapshot() });
	}
	dlcPrompt(): { attemptId: string; prompt: string } | null {
		const attemptId = this.shownAttempt ?? this.dlcSession?.attemptId;
		if (attemptId === undefined) {
			return null;
		}
		const prompt = this.prompts.get(`${this.selectedIntent}:${attemptId}`);
		return prompt === undefined ? null : { attemptId, prompt };
	}
	private dlcSnapshot(): ChatState {
		const active = this.dlcSession;
		if (
			active &&
			active.intentId === this.selectedIntent &&
			(this.shownAttempt === undefined ||
				this.shownAttempt === active.attemptId)
		) {
			return active.session.snapshot();
		}
		return (
			this.history.get(
				`${this.selectedIntent}:${this.shownAttempt ?? "latest"}`,
			) ?? { ...initialState(), connection: "ready" }
		);
	}

	/** 接続、取消し、終了、表示購読の寿命は通常会話と同じ管理元に置く。 */
	executeDlc(
		input: {
			intentId: string;
			attemptId: string;
			backend: BackendId;
			prompt: string;
			root: string;
		},
		signal: AbortSignal,
	): Promise<{
		result: BackendExecutionResult;
		conversation: ChatState;
		approvals: DlcSession["approvals"];
	}> {
		if (this.disposed || this.dlcSession) {
			throw new Error("DLC は既に実行中、または終了しています。");
		}
		signal.throwIfAborted();
		const session = this.factory(input.backend);
		const abort = new AbortController();
		const combined = AbortSignal.any([
			signal,
			abort.signal,
			AbortSignal.timeout(600000),
		]);
		const unsubscribe = session.subscribe((event) => {
			this.rememberOwnership(session.snapshot().sessionId);
			if (
				this.mode === "dlc" &&
				this.selectedIntent === input.intentId &&
				this.shownAttempt === undefined
			) {
				this.emit(event);
			}
		});
		const operation = Promise.resolve().then(() =>
			this.executeSession(session, input.prompt, input.root, combined),
		);
		void operation.catch(() => {});
		const active: DlcSession = {
			...input,
			session,
			abort,
			operation,
			approvals: [],
			unsubscribe,
		};
		this.dlcSession = active;
		this.prompts.set(`${input.intentId}:${input.attemptId}`, input.prompt);
		this.latestAttempts.set(input.intentId, input.attemptId);
		this.shownAttempt = undefined;
		const completed = operation
			.then(async (result) => {
				const conversation =
					(await session.executionConversation?.()) ??
					session.snapshot();
				this.records.set(
					`${input.intentId}:${input.attemptId}`,
					conversation,
				);
				const projected = this.projectConversation(conversation);
				this.history.set(
					`${input.intentId}:${input.attemptId}`,
					projected,
				);
				this.history.set(`${input.intentId}:latest`, projected);
				return {
					result,
					conversation,
					approvals: [...active.approvals],
				};
			})
			.finally(() => this.finishSession(active));
		active.finished = completed.then(
			() => undefined,
			() => undefined,
		);
		this.emit({ type: "state/snapshot", state: this.snapshot() });
		return completed;
	}
	private async executeSession(
		session: BackendSession,
		prompt: string,
		root: string,
		combined: AbortSignal,
	): Promise<BackendExecutionResult> {
		if (!session.connect || !session.execute) {
			throw new Error("このバックエンドは内部実行に対応していません。");
		}
		let connected = false;
		const interrupted = () => {
			session.cancelExecution?.();
			if (!connected) {
				session.invalidate();
			}
		};
		combined.addEventListener("abort", interrupted, { once: true });
		try {
			await session.connect();
			combined.throwIfAborted();
			connected = true;
			this.rememberOwnership(session.snapshot().sessionId);
			await this.ownership?.flush();
			const cwd = session.snapshot().cwd;
			if (cwd === null || (await realpath(cwd)) !== root) {
				throw new Error(
					"DLC とバックエンドのワークスペースが一致しません。",
				);
			}
			return await session.execute(prompt, combined);
		} finally {
			combined.removeEventListener("abort", interrupted);
		}
	}
	private async finishSession(active: DlcSession): Promise<void> {
		try {
			await this.rememberSession(active);
		} finally {
			active.unsubscribe();
			try {
				await active.session.dispose();
			} finally {
				if (this.dlcSession === active) {
					this.dlcSession = undefined;
				}
				if (
					this.selectedIntent === active.intentId &&
					this.shownAttempt === undefined
				) {
					this.shownAttempt = active.attemptId;
				}
				this.emit({ type: "state/snapshot", state: this.snapshot() });
			}
		}
	}
	private async rememberSession(active: DlcSession): Promise<void> {
		if (!this.history.has(`${active.intentId}:${active.attemptId}`)) {
			const conversation =
				(await active.session.executionConversation?.()) ??
				active.session.snapshot();
			this.records.set(
				`${active.intentId}:${active.attemptId}`,
				conversation,
			);
			const projected = this.projectConversation(conversation);
			this.history.set(
				`${active.intentId}:${active.attemptId}`,
				projected,
			);
			this.history.set(`${active.intentId}:latest`, projected);
		}
	}
	conversation(intentId: string, attemptId: string): ChatState | undefined {
		return this.records.get(`${intentId}:${attemptId}`);
	}
	private projectConversation(state: ChatState): ChatState {
		return {
			...state,
			tools: state.tools.map((tool) => this.historyOutputs.project(tool)),
		};
	}
	async stopDlc(attemptId: string): Promise<void> {
		const active = this.dlcSession;
		if (active?.attemptId !== attemptId) {
			return;
		}
		active.abort.abort();
		await (active.finished ?? active.operation.catch(() => {}));
	}

	/** 切替途中でも生成した接続を残さず終了する。 */
	dispose(): Promise<void> {
		if (!this.closing) {
			this.disposed = true;
			this.unsubscribe?.();
			this.listeners.clear();
			const current = this.current;
			this.current = undefined;
			this.closing = Promise.all([
				this.dlcSession
					? this.stopDlc(this.dlcSession.attemptId).then(() =>
							this.dlcSession?.session.dispose(),
						)
					: undefined,
				current?.dispose(),
				this.restarting,
			]).then(() => {
				this.historyOutputs.dispose();
			});
		}
		return this.closing;
	}

	/** 旧接続の通知を遮断し、終了後に新しい会話を開始する。 */
	private async replace(): Promise<void> {
		const previous = this.current;
		this.unsubscribe?.();
		this.current = undefined;
		this.error = null;
		this.emit({ type: "state/snapshot", state: this.snapshot() });
		try {
			await previous?.dispose();
			if (this.disposed) {
				return;
			}
			const next = this.factory();
			this.attach(next);
			this.emit({ type: "state/snapshot", state: this.snapshot() });
			await next.receive({
				type: "connection/retry",
				requestId: randomUUID(),
			});
		} catch {
			this.error =
				"バックエンドを開始できませんでした。再接続してください。";
			this.emit({ type: "state/snapshot", state: this.snapshot() });
		}
	}

	/** 古い接続から遅れて届いた通知を破棄する。 */
	private attach(session: BackendSession): void {
		this.current = session;
		this.unsubscribe = session.subscribe((event) => {
			if (
				this.current === session &&
				!this.disposed &&
				this.mode === "chat"
			) {
				this.emit(event);
			}
		});
	}

	/** 差分の基準番号も変換し、不要な状態再取得とスクロール復元を防ぐ。 */
	private emit(event: HostMessage): void {
		if (this.disposed) {
			return;
		}
		if (event.type === "state/snapshot") {
			event = {
				...event,
				state: { ...event.state, revision: ++this.revision },
			};
		} else if (event.type === "state/patch") {
			const baseRevision = this.revision;
			event = { ...event, baseRevision, revision: ++this.revision };
		}
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
