// VS Code の信頼・利用者別選択を、Intent の保存と共通 Runtime の操作へ接続する。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DlcController } from "@nerita/dlc/controller";
import type { WorkspaceDetection } from "@nerita/dlc/workspace";
import type {
	DlcUiMessage,
	DlcView,
	DlcStartHold,
} from "@nerita/shared/dlc/contracts";
import type { BackendId } from "@nerita/shared/backend";
import type { HostMessage } from "@nerita/shared/messages";
import { errorText } from "@nerita/shared/errorText";
import { requireLocalWorkspace } from "../workspace";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import type { BackendRuntime } from "../session/BackendRuntime";
import { IntentRepository } from "./IntentRepository";
import { SafeDlcFiles } from "./SafeDlcFiles";
import { initializeWorkspace } from "./WorkspaceDetection";
import { withDlcLock } from "./DlcLock";
import { DlcRuntime } from "./DlcRuntime";
import { collectSourceSnapshot } from "./SourceSnapshot";
import { intentSummary } from "./IntentSummary";
import { ProjectStorage } from "./ProjectStorage";
import { WorktreeManager } from "./WorktreeManager";
import { z } from "zod";
import { containsPath } from "../security/AgentAccessPolicy";
import { hostStorageRoot } from "../session/HostStorage";
import { DirectoryRunConflictError } from "../session/DirectoryRuns";

const execute = promisify(execFile);

/** DLC の保存先・検出結果・実行割当を、同じルートと中断シグナルで保持する。 */
type Workspace = {
	root: string;
	signal: AbortSignal;
	repository: IntentRepository;
	detection: WorkspaceDetection;
	selectionKey: string;
	storage: ProjectStorage;
	worktrees: WorktreeManager;
	assignments: Record<string, { targetId: string; backend: BackendId }>;
};

/** コマンドと Webview は同じ操作を使い、表示と実行の責任を分ける。 */
export class DlcHost {
	private workspace: Promise<Workspace> | undefined;
	private controllers = new Map<string, Promise<DlcController>>();
	private selected: DlcController | undefined;
	private selectedId: string | undefined;
	private intents: DlcView["intents"] = [];
	private environment: DlcView["environment"] = null;
	private error: string | null = null;
	private generation = 0;
	private workspaceAbort = new AbortController();
	private closed = false;
	private workspaceOpen = false;
	private runningIntents = new Set<string>();
	private controllerActions = new Map<string, Set<object>>();
	private assigningIntents = new Set<string>();
	private targets: DlcView["targets"] = [];
	private targetTrust = new Map<string, Record<BackendId, boolean>>();
	private targetId: string | null = null;
	private resetting: Promise<void> | undefined;
	private selectionSequence = 0;
	private backend: BackendId;
	private startHolds = new Map<string, DlcStartHold>();
	private unsubscribeTrust: () => void;
	/** 保存済みバックエンドを復元し、信頼・チャット・DLC の変更を表示更新へ接続する。 */
	constructor(
		private context: vscode.ExtensionContext,
		private trust: WorkspaceTrustStore,
		private runtime: BackendRuntime,
	) {
		const saved: unknown = context.globalState.get("dlc.backend");
		this.backend =
			saved === "pi" || saved === "codex"
				? saved
				: vscode.workspace
						.getConfiguration("nerita")
						.get<BackendId>("backend", "codex");
		runtime.setDlcHandler((message) => this.receive(message));
		this.unsubscribeTrust = trust.onChange(() => {
			void this.trustChanged().catch((error: unknown) => {
				if (this.closed) {
					return;
				}
				this.error = errorText(error);
				this.publish();
			});
		});

		/** 会話状態が変化した通知だけで、DLC の画面状態を再配信する。 */
		const publishState = (event: HostMessage) => {
			const stateChanged =
				event.type === "state/snapshot" || event.type === "state/patch";
			if (!stateChanged) {
				return;
			}
			this.publish();
		};
		const unsubscribeChat = runtime.scope("chat").subscribe(publishState);
		const unsubscribeDlc = runtime.scope("dlc").subscribe(publishState);
		context.subscriptions.push({
			dispose: () => {
				unsubscribeChat();
				unsubscribeDlc();
			},
		});
	}
	/** 選択・割当・保留と Runtime の実行状態を、Webview 共通の表示データにまとめる。 */
	view(): DlcView {
		return {
			mode: this.workspaceOpen ? "dlc" : "chat",
			backend: this.backend,
			intents: this.intents.map((intent) => ({
				...intent,
				startHold:
					intent.status === "idle"
						? this.startHold(intent.intentId)
						: undefined,
				...(this.executionForIntent.has(intent.intentId)
					? {
							execution: this.executionForIntent.get(
								intent.intentId,
							)!,
						}
					: {}),
			})),
			targets: this.targets.map((target) => ({
				...target,
				trusted:
					this.targetTrust.get(target.id)?.[this.backend] ?? false,
			})),
			targetId: this.targetId,
			assignmentPending: this.assigningIntents.has(this.selectedId ?? ""),
			targetBusy: this.targets.some(
				(target) =>
					target.id === this.targetId &&
					this.runtime
						.runningDirectories()
						.some(
							(root) =>
								containsPath(root, target.directory) ||
								containsPath(target.directory, root),
						),
			),
			running: this.runtime.activeDlcs().map((active) => ({
				...active,
				targetId: this.targetsForIntent.get(active.intentId) ?? null,
			})),
			environment: this.environment,
			selected: this.selected?.projection() ?? null,
			error: this.error,
			active: this.runtime.activeDlc(),
			execution: this.runtime.dlcPrompt(),
		};
	}
	/** 一覧の保留表示は開始の許可を意味しない。実際の開始は Runtime の予約で再判定する。 */
	private startHold(intentId: string): DlcStartHold | undefined {
		if (this.runningIntents.has(intentId)) {
			return undefined;
		}
		const held = this.startHolds.get(intentId);
		if (held) {
			return held;
		}
		const targetId = this.targetsForIntent.get(intentId);
		const target =
			targetId !== undefined
				? this.targets.find((item) => item.id === targetId)
				: this.targets.find((item) => item.main);
		if (!target) {
			return {
				reason: "unavailable",
				message:
					"実行先を確認できません。再読込みして Worktree を選択してください。",
			};
		}
		if (this.untrustedTarget(intentId, target)) {
			return {
				reason: "trust-required",
				message: "ワークスペースを信頼してください",
			};
		}
		const targetBusy = this.runtime
			.runningDirectories()
			.some(
				(root) =>
					containsPath(root, target.directory) ||
					containsPath(target.directory, root),
			);
		if (targetBusy) {
			return {
				reason: "worktree-required",
				message:
					"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
			};
		}
		return undefined;
	}
	/** 選択中のバックエンドではなく、各 Intent の保存済み割当に従って表示を判定する。 */
	private untrustedTarget(
		intentId: string,
		target: DlcView["targets"][number] | undefined,
	): boolean {
		return (
			target !== undefined &&
			this.targetTrust.get(target.id)?.[
				this.executionForIntent.get(intentId)?.backend ?? this.backend
			] !== true
		);
	}
	/** 非同期の Store 照合も、表示と同じバックエンド別の信頼規則を使う。 */
	private workspaceTrusted(
		backend: BackendId,
		root: string,
	): boolean | Promise<boolean> {
		return this.trust.trusted(root, backend);
	}
	/** 現在の DLC 状態を Runtime の通知経路から配信する。 */
	private publish(): void {
		this.runtime.publish({ type: "dlc/state", view: this.view() });
	}
	/** エディタの開閉だけを選択モードへ反映し、実行中の会話・Intent は維持する。 */
	setWorkspaceOpen(open: boolean): void {
		// 実行開始で Runtime のモードが変わっても、閉じたエディタを選択済みに戻さない。
		this.workspaceOpen = open;
		this.runtime.selectMode(open ? "dlc" : "chat");
		this.publish();
	}
	private targetsForIntent = new Map<string, string>();
	private executionForIntent = new Map<
		string,
		{ targetId: string; backend: BackendId }
	>();
	/** リセットの完了を待って初期化を共有し、失敗した初期化は次の要求で再試行できるようにする。 */
	private async open(): Promise<Workspace> {
		await this.resetting;
		if (this.closed) {
			throw new Error("DLC は終了しています。");
		}
		this.workspace ??= this.initialize().catch((error: unknown) => {
			this.workspace = undefined;
			throw error;
		});
		return this.workspace;
	}
	/** ローカルの管理元 Worktree と信頼を確認し、世代に結び付いた保存境界を開く。 */
	private async initialize(): Promise<Workspace> {
		const root = await realpath(
			requireLocalWorkspace(
				vscode.workspace.workspaceFolders,
				vscode.workspace.isTrusted,
				vscode.env.remoteName,
			),
		);
		const worktrees = new WorktreeManager(root, hostStorageRoot());
		const targets = await worktrees.list();
		const mainWorkspace = targets.some(
			(target) => target.main && target.root === root,
		);
		if (!mainWorkspace) {
			throw new Error(
				"DLC はリポジトリのメイン作業ディレクトリで使用してください。追加の Worktree では通常チャットを使用してください。",
			);
		}
		const generation = this.generation;
		const signal = this.workspaceAbort.signal;
		// 保存領域を開けない場合も、実行環境の表示と信頼操作を利用できるようにする。
		await this.refreshTargets({ worktrees, signal, assignments: {} });
		this.environment = {
			workspace: basename(root),
			branch: targets.find((target) => target.main)?.branch ?? null,
		};
		this.publish();
		const trusted = await this.workspaceTrusted(this.backend, root);
		if (!trusted) {
			throw new Error(
				"DLC のワークスペースを信頼してください。信頼管理画面で設定できます。",
			);
		}
		// 保存先は Intent 間で共有する。Pi の実行許可は各 Intent の実行先で照合する。
		const files = new SafeDlcFiles(root, () =>
			this.assertWorkspaceCurrent(root, generation, signal),
		);
		const detection = await withDlcLock(files, () =>
			initializeWorkspace(files, signal),
		);
		return this.openStorage(root, files, detection, worktrees, signal);
	}
	/** 失効済みの世代ではファイルシステムへ進まず、呼び出し時点のワークスペースを検証する。 */
	private async assertWorkspaceCurrent(
		root: string,
		generation: number,
		signal: AbortSignal,
	): Promise<void> {
		signal.throwIfAborted();
		if (this.closed || generation !== this.generation) {
			throw new Error(
				"DLC のワークスペースまたは信頼状態が変更されました。",
			);
		}
		const currentRoot = await realpath(
			requireLocalWorkspace(
				vscode.workspace.workspaceFolders,
				vscode.workspace.isTrusted,
				vscode.env.remoteName,
			),
		);
		if (currentRoot !== root) {
			throw new Error(
				"DLC のワークスペースが操作開始時から変更されました。",
			);
		}
	}
	/** 利用者別の保存先と割当を開き、割当の読込みに失敗した場合は保存先を解放する。 */
	private async openStorage(
		root: string,
		files: SafeDlcFiles,
		detection: WorkspaceDetection,
		worktrees: WorktreeManager,
		signal: AbortSignal,
	): Promise<Workspace> {
		const storage = await ProjectStorage.open(
			root,
			hostStorageRoot(),
			async () => {
				await files.path(".nerita/dlc");
			},
		);
		const repository = new IntentRepository(
			files,
			storage.authority,
			storage.files,
		);
		const hash = storage.id;
		try {
			return {
				root,
				signal,
				repository,
				detection,
				selectionKey: `dlc.selection.${hash}`,
				storage,
				worktrees,
				assignments: z
					.record(
						z.string(),
						z.strictObject({
							targetId: z.string(),
							backend: z.enum(["pi", "codex"]),
						}),
					)
					.parse(
						JSON.parse(
							(await storage.files.read(
								".nerita/dlc/assignments.json",
							)) ?? "{}",
						),
					),
			};
		} catch (error) {
			await storage.dispose();
			throw error;
		}
	}
	/** Intent ごとの復旧を1つの Promise にまとめ、実行中の復旧を拒否して状態の購読を接続する。 */
	private controller(
		workspace: Workspace,
		intentId: string,
	): Promise<DlcController> {
		let controller = this.controllers.get(intentId);
		if (!controller) {
			controller = workspace.repository
				.load(intentId)
				.then((state) => {
					const running = this.runtime
						.activeDlcs()
						.some((run) => run.intentId === intentId);
					if (running) {
						throw new Error(
							"実行中の Intent は復旧できません。終了後に再読込みしてください。",
						);
					}
					workspace.repository.assertResumable(state);
					return DlcController.open(
						state,
						new DlcRuntime(
							workspace.repository,
							this.runtime,
							() =>
								workspace.assignments[intentId]?.backend ??
								this.backend,
							() => this.executionRoot(workspace, intentId),
						),
						{
							save: (state, expected) =>
								workspace.repository.save(state, expected),
						},
						randomUUID,
					);
				})
				.then((controller) => {
					controller.subscribe(() =>
						this.updateSummary(controller.projection()),
					);
					return controller;
				})
				.catch((error: unknown) => {
					this.controllers.delete(intentId);
					throw error;
				});
			this.controllers.set(intentId, controller);
		}
		return controller;
	}
	/** 実行ごとに最新の割当を読み、Worktree の確認後にその実行先の信頼を照合する。 */
	private async executionRoot(
		workspace: Workspace,
		intentId: string,
	): Promise<string> {
		const assignment = workspace.assignments[intentId];
		if (!assignment) {
			throw new Error("実行先の Worktree を選択してください。");
		}
		const target = await workspace.worktrees.target(
			assignment.targetId,
			workspace.signal,
		);
		const trusted = await this.workspaceTrusted(
			assignment.backend,
			target.root,
		);
		if (!trusted) {
			throw new Error("実行先のワークスペースの信頼を確認してください。");
		}
		return target.root;
	}

	/** Controller の通知から該当 Intent の一覧表示だけを置き換え、他の Intent の項目を保つ。 */
	private updateSummary(projection: DlcView["selected"]): void {
		if (projection === null) {
			return;
		}
		const summary = intentSummary(projection);
		this.intents = this.intents.map((intent) =>
			intent.intentId === summary.intentId ? summary : intent,
		);
		this.publish();
	}
	/** Git のブランチ取得の前後で保存境界を確認し、切り替わった接続先の情報を採用しない。 */
	private async refreshEnvironment(workspace: Workspace): Promise<void> {
		await workspace.repository.files.path(".nerita/dlc");
		const branch = await execute(
			"git",
			["-C", workspace.root, "branch", "--show-current"],
			{ windowsHide: true, timeout: 10000, signal: workspace.signal },
		);
		await workspace.repository.files.path(".nerita/dlc");
		const name = branch.stdout.trim();
		this.environment = {
			workspace: basename(workspace.root),
			branch: name === "" ? null : name,
		};
	}
	/** Worktree と信頼を再照合し、失敗時の古い実行先や失効した世代の結果を一覧へ残さない。 */
	private async refreshTargets(
		workspace: Pick<Workspace, "worktrees" | "signal" | "assignments">,
	): Promise<void> {
		const generation = this.generation;
		// 再照合が失敗した場合に、古い実行先を開始可能として表示し続けない。
		this.targets = [];
		const targets = await Promise.all(
			(await workspace.worktrees.list(workspace.signal)).map(
				async (target) => {
					const [pi, codex] = await Promise.all([
						this.trust.trusted(target.root, "pi"),
						this.trust.trusted(target.root, "codex"),
					]);
					return {
						...target,
						directory: target.root,
						trusted: pi,
						trust: { pi, codex },
					};
				},
			),
		);
		if (generation !== this.generation || this.closed) {
			return;
		}
		// 内部処理用の `root`・`trust` は送信しない。受信側は通信契約にないキーを拒否する。
		this.targets = targets.map(
			({ id, directory, name, branch, main, removable, trusted }) => ({
				id,
				directory,
				name,
				branch,
				main,
				removable,
				trusted,
			}),
		);
		this.targetTrust = new Map(
			targets.map((target) => [target.id, target.trust]),
		);
		this.restoreAssignments(workspace);
	}
	/** 割当は Host の保存値を使い、一覧を更新しても利用者の実行先を選び直さない。 */
	private restoreAssignments(
		workspace: Pick<Workspace, "assignments">,
	): void {
		for (const [intentId, assignment] of Object.entries(
			workspace.assignments,
		)) {
			this.targetsForIntent.set(intentId, assignment.targetId);
			this.executionForIntent.set(intentId, assignment);
		}
		const assignedTarget =
			this.selectedId !== undefined
				? workspace.assignments[this.selectedId]?.targetId
				: undefined;
		this.targetId =
			assignedTarget ??
			this.targets.find((target) => target.main)?.id ??
			null;
	}
	/** 実行中と同時保存を拒否し、割当の保存が終わるまで対象 Intent の保存中表示を維持する。 */
	private async assign(
		workspace: Workspace,
		intentId: string,
		targetId: string,
		backend: BackendId,
	): Promise<void> {
		if (this.runningIntents.has(intentId)) {
			throw new Error(
				"実行が終わってから対象の実行先を変更してください。",
			);
		}
		this.assertAssignmentReady(intentId);
		this.assigningIntents.add(intentId);
		this.publish();
		try {
			await this.persistAssignment(
				workspace,
				intentId,
				targetId,
				backend,
			);
		} finally {
			this.assigningIntents.delete(intentId);
			this.publish();
		}
	}
	/** 実行先の保存が完了するまで、その Intent の次の保存・実行操作を拒否する。 */
	private assertAssignmentReady(intentId: string): void {
		if (this.assigningIntents.has(intentId)) {
			throw new Error(
				"実行先を保存しています。完了後に再試行してください。",
			);
		}
	}
	/** Worktree と接続世代を確認して割当を保存し、保存成功後に表示と実行用の参照を切り替える。 */
	private async persistAssignment(
		workspace: Workspace,
		intentId: string,
		targetId: string,
		backend: BackendId,
	): Promise<void> {
		const generation = this.generation;
		await workspace.worktrees.target(targetId, workspace.signal);
		await workspace.repository.locked(async () => {
			if (generation !== this.generation) {
				throw new Error("DLC の管理元が変更されています。");
			}
			const next = {
				...workspace.assignments,
				[intentId]: { targetId, backend },
			};
			await workspace.storage.files.write(
				".nerita/dlc/assignments.json",
				next,
			);
			workspace.assignments = next;
		});
		this.targetsForIntent.set(intentId, targetId);
		this.executionForIntent.set(intentId, { targetId, backend });
		this.startHolds.delete(intentId);
		if (this.selectedId === intentId) {
			this.targetId = targetId;
			this.backend = backend;
		}
	}

	/** Worktree の作成・削除と実行先の選択を扱い、対象に応じてロックと実行予約を使う。 */
	private async worktreeAction(
		workspace: Workspace,
		message: DlcUiMessage,
	): Promise<boolean> {
		if (message.type === "dlc/worktreeCreate") {
			// 実行中の Worktree を変更せずに別の Worktree を作り、保留を解消する操作を提供する。
			const target = await workspace.repository.locked(() =>
				workspace.worktrees.create(workspace.signal),
			);
			await this.trust.registerWorkspace(target.root);
			await this.read();
			return true;
		}
		if (message.type === "dlc/worktreeRemove") {
			const target = await workspace.worktrees.target(message.targetId);
			await this.runtime.withDirectory(target.root, () =>
				workspace.repository.locked(() =>
					workspace.worktrees.remove(
						message.targetId,
						workspace.signal,
					),
				),
			);
			await this.refreshTargets(workspace);
			this.publish();
			return true;
		}
		if (message.type === "dlc/target") {
			const staleSelection =
				message.intentId !== this.selectedId ||
				this.selected?.projection().revision !== message.revision;
			if (staleSelection) {
				throw new Error(
					"Intent の選択または保存内容が変更されています。再読み込みしてください。",
				);
			}
			await this.assign(
				workspace,
				message.intentId,
				message.targetId,
				this.backend,
			);
			this.publish();
			return true;
		}
		return false;
	}

	/** 読込み開始後に利用者が選択を変えていない場合だけ、保存済みの Intent を自動復元する。 */
	private async restoreSelection(
		workspace: Workspace,
		sequence: number,
	): Promise<void> {
		const selectedId =
			this.selectedId ??
			this.context.workspaceState.get<string>(workspace.selectionKey);
		// 一覧の読み込み中に利用者が選んだ Intent を、自動復元で上書きしない。
		if (sequence === this.selectionSequence && selectedId !== undefined) {
			await this.select(workspace, selectedId);
		}
	}
	/** 信頼管理・表示・モード切替・再読み込みの要求を、対応する画面操作や状態更新へ振り分ける。 */
	private async presentation(message: DlcUiMessage): Promise<boolean> {
		if (message.type === "dlc/trust") {
			await vscode.commands.executeCommand(
				"nerita.trust.manage",
				this.backend,
			);
			return true;
		}
		if (message.type === "dlc/open") {
			await vscode.commands.executeCommand("nerita.dlc.openWorkspace");
			return true;
		}
		if (message.type === "dlc/chat") {
			await vscode.commands.executeCommand("nerita.dlc.openWorkspace");
			return true;
		}
		if (message.type === "dlc/editorState") {
			throw new Error(
				"エディタの状態は DLC の作業画面から保存してください。",
			);
		}
		if (message.type === "ui/setMode") {
			await vscode.commands.executeCommand(
				message.mode === "dlc"
					? "nerita.dlc.openWorkspace"
					: "nerita.dlc.closeWorkspace",
			);
			if (message.mode === "chat") {
				// エディタが既に閉じていても、チャットモードの選択を確定して通知する。
				this.setWorkspaceOpen(false);
			} else {
				await this.read();
			}
			return true;
		}
		if (message.type === "dlc/read") {
			await this.read();
			return true;
		}
		return this.backendSelection(message);
	}
	/** バックエンドの切替前に選択と表示版を照合し、実行中の Intent の切替を拒否する。 */
	private validateBackendSelection(
		message: Extract<DlcUiMessage, { type: "dlc/backend" }>,
	): void {
		if (message.intentId !== (this.selectedId ?? null)) {
			throw new Error(
				"選択中の Intent が変更されています。再読み込みしてください。",
			);
		}
		const currentRevision = this.selected?.projection().revision ?? null;
		if (message.revision !== currentRevision) {
			throw new Error(
				"Intent の保存内容が変更されています。再読み込みしてください。",
			);
		}
		const running =
			this.selectedId !== undefined &&
			this.runningIntents.has(this.selectedId);
		if (running) {
			throw new Error(
				"実行が終わってから DLC のバックエンドを変更してください。",
			);
		}
	}
	/** 実行先がある場合は割当と一緒にバックエンドを保存し、利用者の既定選択も更新する。 */
	private async backendSelection(message: DlcUiMessage): Promise<boolean> {
		if (message.type !== "dlc/backend") {
			return false;
		}
		this.validateBackendSelection(message);
		const targetId = this.targetId;
		if (message.intentId !== null && targetId !== null) {
			await this.assign(
				await this.open(),
				message.intentId,
				targetId,
				message.backend,
			);
		} else {
			this.backend = message.backend;
		}
		await this.context.globalState.update("dlc.backend", message.backend);
		if (!this.workspace && this.workspaceOpen) {
			await this.read();
		}
		this.publish();
		return true;
	}

	/** 一覧・環境・実行先を再照合し、選択の自動復元には読込み開始時の選択順序を使う。 */
	private async read(): Promise<void> {
		if (this.runtime.viewMode() === "chat" && !this.workspace) {
			this.publish();
			return;
		}
		const workspace = await this.open();
		const sequence = this.selectionSequence;
		// 再確認中も現在の選択を保持し、並行する実行先の変更を拒否しない。
		this.intents = (await workspace.repository.projections()).map(
			intentSummary,
		);
		await this.refreshEnvironment(workspace);
		await this.refreshTargets(workspace);
		await this.refreshControllers();
		this.startHolds.clear();
		await this.restoreSelection(workspace, sequence);
		this.publish();
	}
	/** 再読込み中に受け付けた操作や実行が使う Controller を保持し、復旧用に作り直さない。 */
	private async refreshControllers(): Promise<void> {
		const retained: Promise<DlcController>[] = [];
		for (const [intentId, controller] of this.controllers) {
			const inUse =
				this.controllerActions.has(intentId) ||
				this.runningIntents.has(intentId);
			if (inUse) {
				retained.push(controller);
			} else {
				this.controllers.delete(intentId);
			}
		}
		// 古い一覧の読込み結果で、待機中に変わった進捗を上書きしない。
		for (const controller of await Promise.all(retained)) {
			this.updateSummary(controller.projection());
		}
	}
	/** 選択順序と接続世代を照合し、古い非同期結果で最新の Intent 選択を上書きしない。 */
	private async select(
		workspace: Workspace,
		intentId: string,
	): Promise<void> {
		const generation = this.generation;
		const sequence = ++this.selectionSequence;
		const controller = await this.controller(workspace, intentId);
		if (generation !== this.generation) {
			throw new Error("DLC の接続先が変更されました。");
		}
		if (sequence !== this.selectionSequence) {
			return;
		}
		await this.context.workspaceState.update(
			workspace.selectionKey,
			intentId,
		);
		if (sequence !== this.selectionSequence) {
			return;
		}
		this.selectedId = intentId;
		this.selected = controller;
		const assignment = workspace.assignments[intentId];
		this.targetId =
			assignment?.targetId ??
			this.targets.find((target) => target.main)?.id ??
			null;
		if (assignment) {
			this.backend = assignment.backend;
		}
		this.runtime.selectDlc(intentId);
		await this.restoreAttempt(workspace, controller, intentId);
	}
	/** 実行中でない Intent に保存済みの会話があれば、最後の試行を表示へ復元する。 */
	private async restoreAttempt(
		workspace: Workspace,
		controller: DlcController,
		intentId: string,
	): Promise<void> {
		const attempt = controller
			.projection()
			.workItems.flatMap((item) => item.attempts)
			.at(-1);
		const canRestore =
			!this.runningIntents.has(intentId) &&
			attempt !== undefined &&
			workspace.repository.hasConversation(intentId, attempt.id);
		if (canRestore) {
			await this.attempt(workspace, {
				type: "dlc/attempt",
				requestId: randomUUID(),
				intentId,
				attemptId: attempt.id,
			});
		}
	}
	/** 不正な UI ペイロードは共通通信境界で拒否済み。期待版は操作直前にも照合する。 */
	async receive(message: DlcUiMessage): Promise<void> {
		this.error = null;
		try {
			await this.dispatch(message);
		} catch (error) {
			this.error = errorText(error);
			this.publish();
			this.runtime.publish({
				type: "request/failed",
				requestId: message.requestId,
				error: this.error,
			});
		}
	}
	/** 表示と Worktree の操作を先に処理し、残る作成・復旧・選択・実行要求を振り分ける。 */
	private async dispatch(message: DlcUiMessage): Promise<void> {
		const presented = await this.presentation(message);
		if (presented) {
			return;
		}
		const workspace = await this.open();
		const worktreeHandled = await this.worktreeAction(workspace, message);
		if (worktreeHandled) {
			return;
		}
		if (message.type === "dlc/create") {
			workspace.detection = await workspace.repository.locked(() =>
				initializeWorkspace(
					workspace.repository.files,
					workspace.signal,
				),
			);
			const state = await workspace.repository.create(
				message.request,
				message.title,
				workspace.detection,
				message.profile,
				{},
				message.projectType,
			);
			await workspace.repository.exportSnapshot(state.intentId);
			this.intents = [
				...this.intents,
				intentSummary(
					(
						await this.controller(workspace, state.intentId)
					).projection(),
				),
			];
			await this.select(workspace, state.intentId);
			this.runtime.selectMode("dlc");
			// 作成済みの選択を公開した後に読み直すと、操作中のコントローラーが失われる。
			this.publish();
			return;
		}
		if (message.type === "dlc/recover") {
			const inUse =
				this.runningIntents.size > 0 || this.controllerActions.size > 0;
			if (inUse) {
				throw new Error(
					"実行が終わってから Intent を復旧してください。",
				);
			}
			await workspace.repository.recoverOrphans();
			await this.refreshControllers();
			this.selected = undefined;
			await this.read();
			return;
		}
		if (message.type === "dlc/select") {
			await this.select(workspace, message.intentId);
			this.publish();
			return;
		}
		if (message.type === "dlc/attempt") {
			await this.attempt(workspace, message);
			return;
		}
		if (message.type === "dlc/action") {
			await this.action(workspace, message);
		}
	}
	/** 選択世代を固定して試行の会話を表示する。同じ試行が実行中なら現在の会話を維持する。 */
	private async attempt(
		workspace: Workspace,
		message: Extract<DlcUiMessage, { type: "dlc/attempt" }>,
	): Promise<void> {
		if (message.intentId !== this.selectedId) {
			throw new Error(
				"選択中の Intent が変更されています。対象を選び直してください。",
			);
		}
		const selection = this.runtime.beginAttemptSelection(message.intentId);
		const active = this.runtime.activeDlc();
		const alreadyActive =
			active?.intentId === message.intentId &&
			active.attemptId === message.attemptId;
		if (alreadyActive) {
			this.runtime.selectDlc(message.intentId);
			return;
		}
		await this.restoreConversation(
			workspace,
			message.intentId,
			message.attemptId,
		);
		this.runtime.showAttempt(
			message.intentId,
			message.attemptId,
			await workspace.repository.conversation(
				message.intentId,
				message.attemptId,
			),
			(
				await workspace.repository.runContext(
					message.intentId,
					message.attemptId,
				)
			).prompt,
			selection,
		);
		return;
	}
	/** 同じ Host に全文が残り、実行が終了した会話だけを再保存する。 */
	private async restoreConversation(
		workspace: Workspace,
		intentId: string,
		attemptId: string,
	): Promise<void> {
		if (workspace.repository.hasConversation(intentId, attemptId)) {
			return;
		}
		const running = this.runtime
			.activeDlcs()
			.some(
				(run) =>
					run.intentId === intentId && run.attemptId === attemptId,
			);
		if (running) {
			return;
		}
		const conversation = this.runtime.conversation(intentId, attemptId);
		if (conversation) {
			await workspace.repository.runContext(intentId, attemptId);
			await workspace.repository.saveConversation(
				intentId,
				attemptId,
				conversation,
			);
		}
	}
	/** 期待版を照合し、操作中の Controller は再読込みから保護して完了時に解放する。 */
	private async action(
		workspace: Workspace,
		message: Extract<DlcUiMessage, { type: "dlc/action" }>,
	): Promise<void> {
		const release = this.retainController(message.intentId);
		try {
			const controller = await this.controller(
				workspace,
				message.intentId,
			);
			if (message.revision >= 0) {
				if (message.intentId !== this.selectedId) {
					throw new Error(
						"表示中の Intent が現在の状態と一致しません。再読み込みしてください。",
					);
				}
				const currentRevision = controller.projection().revision;
				if (currentRevision !== message.revision) {
					throw new Error(
						"表示中の Intent が現在の状態と一致しません。再読み込みしてください。",
					);
				}
			}
			await this.dispatchAction(workspace, controller, message);
			this.publish();
		} finally {
			release();
		}
	}
	/** 非同期読込みの前から終了時の保存まで Controller を保持する。停止要求も実行要求と同じ Controller を使う。 */
	private retainController(intentId: string): () => void {
		const actions =
			this.controllerActions.get(intentId) ?? new Set<object>();
		const owner = {};
		actions.add(owner);
		this.controllerActions.set(intentId, actions);
		return () => {
			actions.delete(owner);
			const released =
				actions.size === 0 &&
				this.controllerActions.get(intentId) === actions;
			if (released) {
				this.controllerActions.delete(intentId);
			}
		};
	}
	/** 停止は保存版の照合より先に届け、再試行は実行先の実測、開始は Runtime の予約へ進める。 */
	private async dispatchAction(
		workspace: Workspace,
		controller: DlcController,
		message: Extract<DlcUiMessage, { type: "dlc/action" }>,
	): Promise<void> {
		this.assertAssignmentReady(message.intentId);
		if (message.action.type === "cancel") {
			await controller.dispatch(message.action);
			return;
		}
		const persisted = await workspace.repository.load(message.intentId);
		if (persisted.revision !== controller.projection().revision) {
			throw new Error(
				"別のウィンドウで Intent が変更されました。再読込みしてください。",
			);
		}
		if (message.action.type === "retry") {
			const target = workspace.assignments[message.intentId];
			if (!target) {
				throw new Error("実行先を選択してください。");
			}
			await collectSourceSnapshot(
				(await workspace.worktrees.target(target.targetId)).root,
				workspace.signal,
			);
		}
		if (message.action.type !== "run") {
			await controller.dispatch(message.action);
			if (!controller.projection().canCancel) {
				await workspace.repository.exportSnapshot(message.intentId);
			}
			return;
		}
		await this.startRun(workspace, controller, message);
	}
	/** 開始前の保留を Intent ごとに保持し、実行中の別 Intent へ影響させない。 */
	private async startRun(
		workspace: Workspace,
		controller: DlcController,
		message: Extract<DlcUiMessage, { type: "dlc/action" }>,
	): Promise<void> {
		if (this.runningIntents.has(message.intentId)) {
			throw new Error("この Intent は既に実行中です。");
		}
		this.runningIntents.add(message.intentId);
		this.startHolds.delete(message.intentId);
		try {
			if (!workspace.assignments[message.intentId]) {
				if (this.targetId === null) {
					throw new Error("実行先を選択してください。");
				}
				await this.persistAssignment(
					workspace,
					message.intentId,
					this.targetId,
					this.backend,
				);
			}
			this.runtime.selectMode("dlc");
			await controller.dispatch(message.action);
			await workspace.repository.exportSnapshot(message.intentId);
		} catch (error) {
			if (controller.projection().canRun) {
				const target = this.targets.find(
					(item) =>
						item.id === this.targetsForIntent.get(message.intentId),
				);
				const fallbackReason = this.untrustedTarget(
					message.intentId,
					target,
				)
					? "trust-required"
					: "unavailable";
				const reason =
					error instanceof DirectoryRunConflictError
						? "worktree-required"
						: fallbackReason;
				const holdMessages = {
					"worktree-required":
						"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
					"trust-required": "ワークスペースを信頼してください",
					unavailable: errorText(error),
				};
				this.startHolds.set(message.intentId, {
					reason,
					message: holdMessages[reason],
				});
			}
			throw error;
		} finally {
			this.runningIntents.delete(message.intentId);
		}
	}
	/** 同時のリセットを1つの Promise にまとめ、古い保存先の解放を次の初期化より先に終える。 */
	reset(): Promise<void> {
		this.resetting ??= this.clearWorkspace().finally(() => {
			this.resetting = undefined;
		});
		return this.resetting;
	}
	/** 接続世代を失効させて実行を停止し、保存先と選択・Controller の参照を解放する。 */
	private async clearWorkspace(): Promise<void> {
		const workspace = this.workspace;
		this.generation++;
		this.workspaceAbort.abort(
			new Error("DLC のワークスペースが変更されました。"),
		);
		this.workspaceAbort = new AbortController();
		this.selectionSequence++;
		await Promise.all(
			this.runtime
				.activeDlcs()
				.map((active) => this.runtime.stopDlc(active.attemptId)),
		);
		if (workspace) {
			await workspace.then(
				(value) => value.storage.dispose(),
				() => undefined,
			);
		}
		this.workspace = undefined;
		this.controllers.clear();
		this.selected = undefined;
		this.selectedId = undefined;
		this.controllerActions.clear();
		this.intents = [];
		this.environment = null;
		this.targets = [];
		this.targetId = null;
		this.targetsForIntent.clear();
		this.executionForIntent.clear();
		this.startHolds.clear();
		this.runtime.selectDlc(undefined);
		this.publish();
	}
	/** 新しい要求と信頼通知の受付を閉じてから、リセットを待って保存先を解放する。 */
	async dispose(): Promise<void> {
		this.closed = true;
		this.unsubscribeTrust();
		await this.reset();
	}
	/** 信頼変更は実行先の表示へ反映する。Pi の実行取消しは Runtime が担当する。 */
	private async trustChanged(): Promise<void> {
		const generation = this.generation;
		if (this.closed) {
			return;
		}
		const workspace = await this.workspace?.catch(() => undefined);
		await this.trust.waitForChanges();
		if (generation !== this.generation) {
			return;
		}
		if (!workspace) {
			if (this.workspaceOpen) {
				this.error = null;
				await this.read();
			}
			return;
		}
		await this.refreshTargets(workspace);
		this.startHolds.clear();
		this.publish();
	}
}
