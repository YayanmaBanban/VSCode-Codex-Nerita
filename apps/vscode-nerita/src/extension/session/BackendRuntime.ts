// 表示先とコマンドの接続先を保持し、バックエンドの終了・再生成を管理する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { WorkflowExecution } from "@nerita/shared/workflows/messages";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { DirectoryRuns, sessionWriting } from "./DirectoryRuns";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import type { BackendSession, ChatSession } from "./chatSession";
import { RuntimeView } from "./RuntimeView";
import type { BackendId } from "@nerita/shared/backend";
import {
	DlcUiMessageSchema,
	type DlcUiMessage,
} from "@nerita/shared/dlc/contracts";
import type { BackendExecutionResult } from "./BackendExecution";
import { ToolOutputStore } from "./ToolOutputStore";
import type { DlcSessionOwnership } from "./DlcSessionOwnership";
import { containsPath } from "../security/AgentAccessPolicy";

/** 依頼と実行世代を固定したバックエンド入力。実行先のルートも同じ組で保持する。 */
type DlcInput = {
	intentId: string;
	attemptId: string;
	backend: BackendId;
	prompt: string;
	root: string;
};

/** DLC 実行のセッションと解除処理。実行結果・承認・ディレクトリの予約を同じ世代に結び付ける。 */
type DlcSession = DlcInput & {
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
	releaseDirectory: () => Promise<void>;
};

/** 旧接続の終了を待ち、購読を新しいセッションへ引き継ぐ。 */
export class BackendRuntime implements BackendSession {
	private current: BackendSession | undefined;
	private retiredChat: BackendSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private display = new RuntimeView(
		() => this.snapshotState(),
		(value) => this.receive(value),
	);
	private chatView = new RuntimeView(
		() => this.snapshotState("chat"),
		(value) => this.receiveScoped(value, "chat"),
	);
	private dlcView = new RuntimeView(
		() => this.snapshotState("dlc"),
		(value) => this.receiveScoped(value, "dlc"),
	);
	private restarting: Promise<void> | undefined;
	private closing: Promise<void> | undefined;
	private disposed = false;
	private error: string | null = null;
	private admissions: Promise<void> = Promise.resolve();
	private mode: "chat" | "dlc" = "chat";
	private selectedIntent: string | undefined;
	private dlcSessions = new Map<string, DlcSession>();
	private chatRelease: (() => Promise<void>) | undefined;
	private chatStarting = false;
	private chatSettling: Promise<void> | undefined;
	private chatRoot: string | undefined;
	private reservations = new Map<object, string>();
	private uncertainDirectories = new Set<string>();
	private managedSessionIds = new Set<string>();
	private history = new Map<string, ChatState>();
	private prompts = new Map<string, string>();
	private latestAttempts = new Map<string, string>();
	private records = new Map<string, ChatState>();
	private shownAttempt: string | undefined;
	private attemptSelection = 0;
	private historyOutputs = new ToolOutputStore();
	private dlcHandler: ((message: DlcUiMessage) => Promise<void>) | undefined;

	/** 再生成時に最新の設定を取得する関数を保持する。 */
	constructor(
		private readonly factory: (
			backend?: BackendId,
			root?: string,
		) => BackendSession,
		private readonly ownership?: DlcSessionOwnership,
		private readonly directories = new DirectoryRuns(),
	) {
		this.attach(factory());
	}

	/** 表示先で継続する更新番号を付けて状態を取得する。 */
	snapshot() {
		return this.display.snapshot();
	}
	/** 通常チャットと Phase 3 は同時に開いても、それぞれの会話だけを購読する。 */
	scope(mode: "chat" | "dlc"): ChatSession {
		return mode === "chat" ? this.chatView : this.dlcView;
	}
	/** 通常チャットと DLC の状態を分けて取得し、通常接続のエラーで独立した DLC を上書きしない。 */
	private snapshotState(mode = this.mode): ChatState {
		const state =
			mode === "dlc"
				? this.dlcSnapshot()
				: (this.current?.snapshot() ?? initialState());
		return {
			...state,
			// 通常チャットの接続状態で、独立した DLC の状態を上書きしない。
			...(mode === "chat" && !this.current
				? { connection: "connecting" as const }
				: {}),
			...(mode === "chat" && isNonEmptyString(this.error)
				? { connection: "error" as const, error: this.error }
				: {}),
		};
	}

	/** セッションを交換しても表示先の購読を維持する。 */
	subscribe(listener: (event: HostMessage) => void) {
		return this.display.subscribe(listener);
	}
	/** 表示先の会話 ID を照合し、別画面から DLC の承認・停止を転用させない。 */
	private async receiveScoped(
		value: unknown,
		mode: "chat" | "dlc",
	): Promise<void> {
		if (isUiMessage(value)) {
			this.assertViewSession(value, mode);
		}
		if (mode === "dlc" && isUiMessage(value) && value.type === "ui/ready") {
			this.dlcView.publish({
				type: "state/snapshot",
				state: this.snapshotState("dlc"),
			});
			return;
		}
		await this.receive(value, mode);
	}
	/** 表示中の会話と受信した操作の対象を照合し、通常画面から DLC 会話を操作させない。 */
	private assertViewSession(value: UiMessage, mode: "chat" | "dlc"): void {
		if (!("sessionId" in value)) {
			return;
		}
		const matchesMode =
			mode === "dlc" && value.sessionId !== this.dlcSnapshot().sessionId;
		if (matchesMode) {
			throw new Error(
				"表示中の会話が変更されています。対象を再確認してください。",
			);
		}
		const matchesMode2 =
			mode === "chat" &&
			[...this.dlcSessions.values()].some(
				(active) =>
					active.session.snapshot().sessionId === value.sessionId,
			);
		if (matchesMode2) {
			throw new Error("DLC の会話は Phase 3 から操作してください。");
		}
	}

	/** 切替中の要求を拒否し、生成失敗後は再接続で復旧できるようにする。 */
	async receive(value: unknown, mode = this.mode): Promise<void> {
		if (this.disposed) {
			return;
		}
		const admission = this.admissions.then(() => this.ownership?.refresh());
		this.admissions = admission.then(
			() => {},
			() => {},
		);
		await admission;
		const matchesIsUiMessage =
			isUiMessage(value) && (await this.routeDlc(value, mode));
		if (matchesIsUiMessage) {
			return;
		}
		if (this.restarting) {
			this.rejectSwitching(value, mode);
			return;
		}
		const matchesCurrent =
			!this.current &&
			isUiMessage(value) &&
			value.type === "connection/retry";
		if (matchesCurrent) {
			await this.restart();
			return;
		}
		this.error = null;
		await this.receiveChat(value);
	}

	/** 選択中の Intent の実行を取得する。表示の切替によって他の実行を停止しない。 */
	private visibleDlc(): DlcSession | undefined {
		return [...this.dlcSessions.values()].find(
			(active) => active.intentId === this.selectedIntent,
		);
	}
	/** 実行中の Intent と世代の識別子だけを公開し、内部セッションを外部へ渡さない。 */
	activeDlcs(): { intentId: string; attemptId: string }[] {
		return [...this.dlcSessions.values()].map(
			({ intentId, attemptId }) => ({ intentId, attemptId }),
		);
	}
	/** 開始予約・DLC 実行・通常チャットの予約をまとめ、実行先の競合確認に使う。 */
	runningDirectories(): string[] {
		return [
			...this.reservations.values(),
			...[...this.dlcSessions.values()].map((active) => active.root),
			...(this.chatRelease && this.chatRoot !== undefined
				? [this.chatRoot]
				: []),
		];
	}
	/** 保存された実行入力や根拠の取得も、書込み Run と同じ排他に含める。 */
	async withDirectory<T>(
		root: string,
		operation: (reservation: object) => Promise<T>,
	): Promise<T> {
		const actual = await realpath(root);
		const release = await this.directories.acquire(actual);
		const reservation = {};
		this.reservations.set(reservation, actual);
		try {
			return await operation(reservation);
		} finally {
			if (!this.uncertainDirectories.has(actual)) {
				this.reservations.delete(reservation);
				await release();
			}
		}
	}
	/** 通常会話の操作を現在の接続へ渡し、書き込み中の会話切替と未予約の送信を防ぐ。 */
	private async receiveChat(value: unknown): Promise<void> {
		const current = this.current;
		if (!current) {
			return;
		}
		if (!isUiMessage(value) || value.type !== "prompt/send") {
			const matchesIsUiMessage =
				isUiMessage(value) &&
				["session/new", "session/load", "session/fork"].includes(
					value.type,
				) &&
				sessionWriting(current.snapshot());
			if (matchesIsUiMessage) {
				throw new Error("実行が終わってから会話を切り替えてください。");
			}
			await current.receive(value);
			return;
		}
		await this.submitChat(current, value);
	}
	/** 送信前に実行先を予約し、接続変更を再確認する。失敗しても終了確認に従って予約を回収する。 */
	private async submitChat(
		current: BackendSession,
		value: Extract<UiMessage, { type: "prompt/send" }>,
	): Promise<void> {
		if (this.chatStarting) {
			throw new Error(
				"実行の開始処理中です。開始処理の完了後に再試行してください。",
			);
		}
		this.chatStarting = true;
		try {
			if (!this.chatRelease) {
				const root = current.snapshot().cwd;
				if (root === null) {
					throw new Error("実行先へ接続してから送信してください。");
				}
				this.chatRelease = await this.directories.acquire(root);
				this.chatRoot = await realpath(root);
			}
			if (this.current !== current || this.disposed) {
				throw new Error("会話の接続先が変更されています。");
			}
			await current.receive(value);
		} finally {
			this.chatStarting = false;
			this.updateChatLease();
		}
	}
	/** 書き込み中の会話が終了したときだけ予約の回収を始める。開始・回収の重複は避ける。 */
	private updateChatLease(): void {
		const idleChat =
			!this.chatStarting &&
			!this.chatSettling &&
			this.chatRelease !== undefined;
		if (!idleChat || !this.current) {
			return;
		}
		if (sessionWriting(this.current.snapshot())) {
			return;
		}
		this.chatSettling = this.settleChatLease(this.current)
			.catch(() => {
				this.error =
					"バックエンドの終了を確認できないため、実行先の予約を保持しています。";
				this.publishChatSnapshot();
			})
			.finally(() => {
				this.chatSettling = undefined;
			});
	}
	/** 表示だけ先に終了しても、旧バックエンドの終了確認が済むまで予約を保持する。 */
	private async settleChatLease(session: BackendSession): Promise<void> {
		const release = this.chatRelease;
		await session.waitForShutdown?.();
		const currentChat =
			this.current === session &&
			this.chatRelease === release &&
			!this.chatStarting;
		const matchesCurrentChat =
			currentChat &&
			!this.disposed &&
			!sessionWriting(session.snapshot());
		if (matchesCurrentChat) {
			await this.releaseChat();
		}
	}
	/** 通常チャットの予約を一度だけ取り出して解放する。終了確認の判断は呼出し側で行う。 */
	private async releaseChat(): Promise<void> {
		const release = this.chatRelease;
		this.chatRelease = undefined;
		this.chatRoot = undefined;
		await release?.();
	}

	/** バックエンドの切替中に受けた要求の失敗を、要求元の会話へ通知する。 */
	private rejectSwitching(value: unknown, mode: "chat" | "dlc"): void {
		if (isUiMessage(value) && "requestId" in value) {
			this.emitConversation(
				{
					type: "request/failed",
					requestId: value.requestId,
					error: "バックエンドを切り替えています。完了後に再試行してください。",
				},
				mode,
			);
		}
	}
	/** DLC 操作と内部会話の操作を先に扱い、DLC の表示中に通常チャットへ入力が流れることを防ぐ。 */
	private async routeDlc(
		value: UiMessage,
		mode: "chat" | "dlc",
	): Promise<boolean> {
		const dlc = DlcUiMessageSchema.safeParse(value);
		if (dlc.success) {
			await this.dlcHandler?.(dlc.data);
			return true;
		}
		if (value.type === "tool/output" && mode === "dlc") {
			await this.dlcOutput(value);
			return true;
		}
		const matchesValue = await this.routeManaged(value);
		if (matchesValue) {
			return true;
		}
		const matchesMode =
			mode === "dlc" &&
			[
				"prompt/send",
				"connection/retry",
				"session/new",
				"session/load",
				"session/fork",
				"plan/decide",
				"permission/respond",
				"prompt/cancel",
			].includes(value.type);
		if (matchesMode) {
			throw new Error("現在の Intent と実行を選択して操作してください。");
		}
		if (mode === "dlc") {
			throw new Error("この操作は DLC の会話では利用できません。");
		}
		return false;
	}
	/** 有効な会話 ID だけを DLC の所有記録へ登録し、終了後も通常履歴からの操作を防ぐ。 */
	private rememberOwnership(sessionId: string | null | undefined): void {
		if (isNonEmptyString(sessionId)) {
			this.managedSessionIds.add(sessionId);
			this.ownership?.remember(sessionId);
		}
	}
	/** 実行中の内部会話へ操作を振り分け、終了した DLC の会話へ手動ターンを追加させない。 */
	private async routeManaged(value: UiMessage): Promise<boolean> {
		for (const active of this.dlcSessions.values()) {
			this.rememberOwnership(active.session.snapshot().sessionId);
		}
		const active =
			"sessionId" in value
				? [...this.dlcSessions.values()].find(
						(entry) =>
							entry.session.snapshot().sessionId ===
							value.sessionId,
					)
				: undefined;
		const activeManagedSession =
			active &&
			"sessionId" in value &&
			value.sessionId === active.session.snapshot().sessionId;
		if (activeManagedSession === true) {
			await this.routeDlcSession(active, value);
			return true;
		}
		// 表示モードを戻しても、終了・復元済みの DLC 会話へ手動ターンを追加させない。
		const matchesValue =
			"sessionId" in value &&
			(this.managedSessionIds.has(value.sessionId) ||
				this.ownership?.has(value.sessionId) === true);
		if (matchesValue) {
			throw new Error(
				"この DLC セッションへの操作は、対象の実行が終了したため受け付けられません。",
			);
		}
		return false;
	}
	/** 実行中の本文参照はそのセッションへ渡し、終了済みの参照は保存した出力から取得する。 */
	private async dlcOutput(
		value: Extract<UiMessage, { type: "tool/output" }>,
	): Promise<void> {
		const active = [...this.dlcSessions.values()].find((entry) =>
			entry.session
				.snapshot()
				.tools.some(
					(tool) => tool.output?.outputRef === value.outputRef,
				),
		);
		const matchesSome =
			active?.session
				.snapshot()
				.tools.some(
					(tool) => tool.output?.outputRef === value.outputRef,
				) === true;
		if (matchesSome) {
			await active.session.receive(value);
		} else {
			this.emitConversation(await this.historyOutputs.read(value), "dlc");
		}
	}
	/** 内部会話では承認・停止・子の閲覧だけを許可し、実行中の入力と設定変更を拒否する。 */
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
		const matchesType = [
			"question/respond",
			"execution/stop",
			"agent/read",
			"agent/stop",
		].includes(value.type);
		if (matchesType) {
			await active.session.receive(value);
			return;
		}
		throw new Error("DLC の実行中に会話の入力や設定を変更できません。");
	}
	/** 現在の実行に属する選択肢だけを受け付け、バックエンドが要求を解決した場合に承認記録を残す。 */
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
		const matchesSome = !active.session
			.snapshot()
			.permissions.some((item) => item.id === value.permissionId);
		if (matchesSome) {
			active.approvals.push({
				requestId: permission.id,
				optionId: option.id,
				kind: option.kind,
			});
		}
	}
	/** バックエンドの専用カタログを優先し、未提供の場合は表示済みのモデル候補を使う。 */
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
		const release = await this.directories.acquire(request.root);
		try {
			return await this.current.workflow(request, signal);
		} finally {
			await release();
		}
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
		for (const active of this.dlcSessions.values()) {
			active.abort.abort();
			active.session.invalidate();
		}
	}
	/** 個別の信頼変更はそのルートの会話だけに適用し、独立した Worktree の実行は維持する。 */
	invalidateTrust(root?: string, backend: BackendId = "pi"): void {
		/** 停止対象のルートと親子関係にある実行先を判定し、作業場所が未確定の実行も停止対象に含める。 */
		const affected = (cwd: string | null) => {
			const matchingRoot =
				root === undefined || cwd === null || containsPath(root, cwd);
			return matchingRoot || containsPath(cwd, root);
		};
		this.invalidateChatTrust(affected, backend);
		for (const active of this.dlcSessions.values()) {
			const matchesBackendWorkspaceTrusted =
				active.backend === backend && affected(active.root);
			if (matchesBackendWorkspaceTrusted) {
				active.abort.abort();
				active.session.invalidate();
			}
		}
	}

	/** 信頼を変更したバックエンドの会話だけを無効化する。 */
	private invalidateChatTrust(
		affected: (cwd: string | null) => boolean,
		backend: BackendId,
	): void {
		if (!this.current) {
			return;
		}
		const state = this.current.snapshot();
		const matchesBackend =
			(state.uiContributions?.surface ?? "pi") === backend;
		if (matchesBackend && affected(state.cwd)) {
			this.current.invalidate();
		}
	}

	/** 内部会話の停止なども DLC コントローラーへ届け、独立した状態遷移を作らない。 */
	setDlcHandler(handler: (message: DlcUiMessage) => Promise<void>): void {
		this.dlcHandler = handler;
	}
	/** 操作の振分けに使う表示モードを返し、実行中バックエンドの状態とは区別する。 */
	viewMode(): "chat" | "dlc" {
		return this.mode;
	}
	/** 選択世代を進めて古い履歴取得を失効させ、実行中ならライブ状態、それ以外は最新履歴を表示する。 */
	selectDlc(intentId: string | undefined): void {
		this.attemptSelection++;
		this.selectedIntent = intentId;
		this.shownAttempt = [...this.dlcSessions.values()].some(
			(active) => active.intentId === intentId,
		)
			? undefined
			: this.latestAttempts.get(intentId ?? "");
		this.publishDlcSnapshot();
	}
	/** 表示を切り替えて状態を配信し、独立した会話の実行を停止しない。 */
	selectMode(mode: "chat" | "dlc"): void {
		this.mode = mode;
		this.emit({ type: "state/snapshot", state: this.snapshot() });
	}
	/** 共通通知を表示へ配信し、要求失敗を通常チャットへ重ねて送らない。 */
	publish(event: HostMessage): void {
		this.emit(event);
		this.dlcView.publish(event);
		if (event.type !== "request/failed") {
			this.chatView.publish(event);
		}
	}
	/** 表示中の実行を優先し、未選択の場合は稼働中の一件を操作対象の候補として返す。 */
	activeDlc(): { intentId: string; attemptId: string } | null {
		const active =
			this.visibleDlc() ?? this.dlcSessions.values().next().value;
		return active
			? { intentId: active.intentId, attemptId: active.attemptId }
			: null;
	}
	/** 通常会話の書込みと DLC の実行をまとめ、実行中の設定変更を防ぐ判定に使う。 */
	busy(): boolean {
		const state = this.current?.snapshot();
		const matchesSize =
			this.dlcSessions.size > 0 ||
			(state !== undefined && sessionWriting(state));
		return matchesSize;
	}
	/** 表示要求の受付時に世代を確定し、遅い履歴取得が新しい選択を上書きしないようにする。 */
	beginAttemptSelection(intentId: string): number {
		if (this.selectedIntent !== intentId) {
			throw new Error(
				"選択中の Intent が変更されています。対象を選び直してください。",
			);
		}
		return ++this.attemptSelection;
	}
	/** Intent と選択世代が一致する復元結果だけを公開し、古い取得結果で新しい表示を上書きしない。 */
	showAttempt(
		intentId: string,
		attemptId: string,
		state: ChatState,
		prompt: string,
		selection: number,
	): void {
		const matchesSelectedIntent =
			this.selectedIntent !== intentId ||
			selection !== this.attemptSelection;
		if (matchesSelectedIntent) {
			return;
		}
		this.rememberOwnership(state.sessionId);
		this.history.set(
			`${intentId}:${attemptId}`,
			this.projectConversation(state),
		);
		this.shownAttempt = attemptId;
		this.prompts.set(`${intentId}:${attemptId}`, prompt);
		this.publishDlcSnapshot();
	}
	/** 表示対象の世代に対応した元の指示だけを返し、別の実行の入力と混ぜない。 */
	dlcPrompt(): { attemptId: string; prompt: string } | null {
		const attemptId = this.shownAttempt ?? this.visibleDlc()?.attemptId;
		if (attemptId === undefined) {
			return null;
		}
		const prompt = this.prompts.get(`${this.selectedIntent}:${attemptId}`);
		return prompt === undefined ? null : { attemptId, prompt };
	}
	/** 表示中の世代がライブ実行と一致する場合だけ現在状態を使い、それ以外は保存した履歴を返す。 */
	private dlcSnapshot(): ChatState {
		const active = this.visibleDlc();
		const currentIntent = active && active.intentId === this.selectedIntent;
		const matchesCurrentIntent =
			currentIntent === true &&
			(this.shownAttempt === undefined ||
				this.shownAttempt === active.attemptId);
		if (matchesCurrentIntent) {
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
		input: DlcInput,
		signal: AbortSignal,
		reservation?: object,
	): Promise<{
		result: BackendExecutionResult;
		conversation: ChatState;
		approvals: DlcSession["approvals"];
	}> {
		const matchesDisposed =
			this.disposed ||
			[...this.dlcSessions.values()].some(
				(active) => active.intentId === input.intentId,
			);
		if (matchesDisposed) {
			throw new Error(
				"この Intent は既に実行中か、DLC が終了しています。",
			);
		}
		signal.throwIfAborted();
		const active = this.startDlcSession(input, signal, reservation);
		this.dlcSessions.set(input.attemptId, active);
		this.prompts.set(`${input.intentId}:${input.attemptId}`, input.prompt);
		this.latestAttempts.set(input.intentId, input.attemptId);
		if (this.selectedIntent === input.intentId) {
			this.attemptSelection++;
			this.shownAttempt = undefined;
		}
		const completed = this.completeDlcSession(active);
		active.finished = completed.then(
			() => undefined,
			() => undefined,
		);
		this.publishDlcSnapshot();
		return completed;
	}
	/** 取消しと期限を実行へ結び付け、予約の照合または取得を済ませてからバックエンドを実行する。 */
	private startDlcSession(
		input: DlcInput,
		signal: AbortSignal,
		reservation?: object,
	): DlcSession {
		const session = this.factory(input.backend, input.root);
		const abort = new AbortController();
		const combined = AbortSignal.any([
			signal,
			abort.signal,
			AbortSignal.timeout(600000),
		]);
		const unsubscribe = session.subscribe((event) => {
			this.rememberOwnership(session.snapshot().sessionId);

			const showingLiveAttempt =
				this.selectedIntent === input.intentId &&
				this.shownAttempt === undefined;
			if (showingLiveAttempt) {
				this.emitConversation(event, "dlc");
			}
		});
		let releaseDirectory: (() => Promise<void>) | undefined;
		/** 予約の照合と実行開始は次のマイクロタスクで行い、呼出し元へ実行状態を先に返す。 */
		const executeReservedSession = async () => {
			/** DLC の入力とセッションを固定し、ディレクトリの予約後に実行を開始する。 */
			const execute = () =>
				this.executeSession(
					session,
					input.prompt,
					input.root,
					combined,
				);
			if (reservation !== undefined) {
				const matchesGet =
					this.reservations.get(reservation) !==
					(await realpath(input.root));
				if (matchesGet) {
					throw new Error("実行先の予約が一致しません。");
				}
				return execute();
			}
			releaseDirectory = await this.directories.acquire(input.root);
			return execute();
		};
		const operation = Promise.resolve().then(executeReservedSession);
		void operation.catch(() => {});
		return {
			...input,
			session,
			abort,
			operation,
			approvals: [],
			unsubscribe,
			releaseDirectory: () => releaseDirectory?.() ?? Promise.resolve(),
		};
	}
	/** 成功した実行の会話と承認記録を保持し、成功・失敗の両方で終了処理を完了させる。 */
	private completeDlcSession(active: DlcSession) {
		const input = active;
		const session = active.session;
		return active.operation
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
	}
	/** 接続後の実効ルートを DLC の対象と照合し、接続中の取消しも伝えてから指示を送る。 */
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
		/** 中断時に現在の実行を取り消し、接続前ならセッションも失効させる。 */
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

			if (cwd === null) {
				throw new Error("バックエンドの作業フォルダを取得できません。");
			}
			const connectedRoot = await realpath(cwd);
			if (connectedRoot !== root) {
				throw new Error(
					"DLC とバックエンドのワークスペースが一致しません。",
				);
			}
			return await session.execute(prompt, combined);
		} finally {
			combined.removeEventListener("abort", interrupted);
		}
	}
	/** 会話を保持して購読を外し、バックエンド終了の確認後に実行先を解放する。失敗時も表示状態は回収する。 */
	private async finishSession(active: DlcSession): Promise<void> {
		try {
			await this.rememberSession(active);
		} finally {
			active.unsubscribe();
			try {
				await this.disposeSession(active);
				await active.releaseDirectory();
			} finally {
				if (this.dlcSessions.get(active.attemptId) === active) {
					this.dlcSessions.delete(active.attemptId);
				}

				const selectFinishedAttempt =
					this.selectedIntent === active.intentId &&
					this.shownAttempt === undefined;
				if (selectFinishedAttempt) {
					this.shownAttempt = active.attemptId;
				}
				this.publishDlcSnapshot();
			}
		}
	}
	/** 終了確認に失敗したルートを記録し、確認できない実行先を新たな実行へ再利用しない。 */
	private async disposeSession(active: DlcSession): Promise<void> {
		try {
			await active.session.dispose();
		} catch (error) {
			this.uncertainDirectories.add(active.root);
			throw error;
		}
	}
	/** 成功結果が保存されていない場合も終了時の会話を保持し、失敗・停止後の履歴を失わない。 */
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
	/** 実行世代に対応した元の会話を取得し、別の Intent や世代の会話を返さない。 */
	conversation(intentId: string, attemptId: string): ChatState | undefined {
		return this.records.get(`${intentId}:${attemptId}`);
	}
	/** 大きなツール出力を本文参照へ投影し、履歴の表示に必要な状態を保持する。 */
	private projectConversation(state: ChatState): ChatState {
		return {
			...state,
			tools: state.tools.map((tool) => this.historyOutputs.project(tool)),
		};
	}
	/** 指定した世代だけを取り消し、停止の通知ではなく終了処理の完了まで待つ。 */
	async stopDlc(attemptId: string): Promise<void> {
		const active = this.dlcSessions.get(attemptId);
		if (!active) {
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
			this.display.dispose();
			this.chatView.dispose();
			this.dlcView.dispose();
			const current = this.current;
			this.current = undefined;
			this.closing = Promise.all([
				...[...this.dlcSessions.keys()].map((attemptId) =>
					this.stopDlc(attemptId),
				),
				(current ?? this.retiredChat)?.dispose(),
				this.restarting,
			]).then(() => {
				this.historyOutputs.dispose();
				return this.releaseChat();
			});
		}
		return this.closing;
	}

	/** 旧接続の通知を遮断し、終了後に新しい会話を開始する。 */
	private async replace(): Promise<void> {
		const previous = this.current ?? this.retiredChat;
		this.unsubscribe?.();
		this.current = undefined;
		// 終了が拒否されても次の再接続で予約を解放しないよう、終了確認の対象を保持する。
		this.retiredChat = previous;
		this.error = null;
		this.publishChatSnapshot();
		try {
			await previous?.dispose();
			await this.releaseChat();
			this.retiredChat = undefined;
			if (this.disposed) {
				return;
			}
			const next = this.factory();
			this.attach(next);
			this.publishChatSnapshot();
			await next.receive({
				type: "connection/retry",
				requestId: randomUUID(),
			});
		} catch {
			this.error =
				"バックエンドを開始できませんでした。再接続してください。";
			this.publishChatSnapshot();
		}
	}

	/** 古い接続から遅れて届いた通知を破棄する。 */
	private attach(session: BackendSession): void {
		this.current = session;
		this.unsubscribe = session.subscribe((event) => {
			if (this.current === session && !this.disposed) {
				this.updateChatLease();
				this.emitConversation(event, "chat");
			}
		});
	}

	/** 差分の基準番号も変換し、不要な状態再取得とスクロール復元を防ぐ。 */
	private emit(event: HostMessage): void {
		if (this.disposed) {
			return;
		}
		this.display.publish(event);
	}
	/** 破棄後の通知を止め、各会話の状態は専用表示へ、選択中のモードだけを共通表示へ配信する。 */
	private emitConversation(event: HostMessage, mode: "chat" | "dlc"): void {
		if (this.disposed) {
			return;
		}
		(mode === "chat" ? this.chatView : this.dlcView).publish(event);
		if (mode === this.mode) {
			this.emit(event);
		}
	}
	/** DLC 専用表示を更新し、共通表示には現在選択しているモードの状態を配信する。 */
	private publishDlcSnapshot(): void {
		this.dlcView.publish({
			type: "state/snapshot",
			state: this.snapshotState("dlc"),
		});
		this.emit({ type: "state/snapshot", state: this.snapshotState() });
	}
	/** 通常チャット専用表示を更新し、共通表示には現在選択しているモードの状態を配信する。 */
	private publishChatSnapshot(): void {
		this.chatView.publish({
			type: "state/snapshot",
			state: this.snapshotState("chat"),
		});
		this.emit({ type: "state/snapshot", state: this.snapshotState() });
	}
}
