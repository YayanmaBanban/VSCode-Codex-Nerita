// VS Code の信頼・利用者別選択を、Intent の保存と共通 Runtime の操作へ接続する。
import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DlcController } from "@nerita/dlc/controller";
import { migrateLegacy } from "@nerita/dlc/migration";
import { catalogVersion, profileVersion } from "@nerita/dlc/catalog";
import type { WorkspaceDetection } from "@nerita/dlc/workspace";
import type {
	DlcUiMessage,
	DlcView,
	DlcAction,
} from "@nerita/shared/dlc/contracts";
import type { BackendId } from "@nerita/shared/backend";
import type { HostMessage } from "@nerita/shared/messages";
import { errorText } from "@nerita/shared/errorText";
import { requireLocalWorkspace } from "../workspace";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import type { BackendRuntime } from "../session/BackendRuntime";
import { IntentRepository, currentCatalogDigest } from "./IntentRepository";
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

const execute = promisify(execFile);

type Workspace = {
	root: string;
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
	private closed = false;
	private runningIntents = new Set<string>();
	private assigningIntents = new Set<string>();
	private targets: DlcView["targets"] = [];
	private targetId: string | null = null;
	private resetting: Promise<void> | undefined;
	private selectionSequence = 0;
	private backend: BackendId;
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

		const publishState = (event: HostMessage) => {
			if (
				event.type !== "state/snapshot" &&
				event.type !== "state/patch"
			) {
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
	view(): DlcView {
		return {
			mode: this.runtime.viewMode(),
			backend: this.backend,
			intents: this.intents.map((intent) => ({
				...intent,
				...(this.executionForIntent.has(intent.intentId)
					? {
							execution: this.executionForIntent.get(
								intent.intentId,
							)!,
						}
					: {}),
			})),
			targets: this.targets,
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
	private publish(): void {
		this.runtime.publish({ type: "dlc/state", view: this.view() });
	}
	private targetsForIntent = new Map<string, string>();
	private executionForIntent = new Map<
		string,
		{ targetId: string; backend: BackendId }
	>();
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
	private async initialize(): Promise<Workspace> {
		const root = await realpath(
			requireLocalWorkspace(
				vscode.workspace.workspaceFolders,
				vscode.workspace.isTrusted,
				vscode.env.remoteName,
			),
		);
		const worktrees = new WorktreeManager(root, hostStorageRoot());
		if (
			!(await worktrees.list()).some(
				(target) => target.main && target.root === root,
			)
		) {
			throw new Error(
				"DLC の管理元は main の Nerita です。Worktree では通常チャットを使用してください。",
			);
		}
		const generation = this.generation;
		const trustSignal = this.trust.signal;
		const files = new SafeDlcFiles(root, async () => {
			trustSignal.throwIfAborted();
			if (
				this.closed ||
				generation !== this.generation ||
				!(await this.trust.trusted(root)) ||
				(await realpath(
					requireLocalWorkspace(
						vscode.workspace.workspaceFolders,
						vscode.workspace.isTrusted,
						vscode.env.remoteName,
					),
				)) !== root
			) {
				throw new Error(
					"DLC のワークスペースまたは信頼状態が変更されました。",
				);
			}
		});
		const detection = await withDlcLock(files, () =>
			initializeWorkspace(files, trustSignal),
		);
		return this.openStorage(root, files, detection, worktrees);
	}
	private async openStorage(
		root: string,
		files: SafeDlcFiles,
		detection: WorkspaceDetection,
		worktrees: WorktreeManager,
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
			await this.migrateGoal(
				repository,
				detection,
				createHash("sha256").update(root).digest("hex"),
			);
			return {
				root,
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
	private async migrateGoal(
		repository: IntentRepository,
		detection: WorkspaceDetection,
		hash: string,
	): Promise<void> {
		const legacyKey = `dlc.project.${hash}`;
		const legacy: unknown = this.context.workspaceState.get(legacyKey);
		if (legacy !== undefined) {
			const backupKey = `${legacyKey}.migration-backup`;
			const backup = this.context.workspaceState.get<{
				createdAt: string;
				value: unknown;
			}>(backupKey) ?? {
				createdAt: new Date().toISOString(),
				value: legacy,
			};
			const state = migrateLegacy(
				legacy,
				{
					profileId: "classic",
					profileVersion,
					catalogVersion,
					catalogDigest: currentCatalogDigest,
					workspaceFingerprint: detection.scan.inputFingerprint,
					workspaceSchemaVersion: detection.schemaVersion,
					detectorVersion: detection.detectorVersion,
					projectTypeSource: "detected",
					effectiveProjectType: detection.classification.detected,
				},
				backup.createdAt,
			);
			await this.context.workspaceState.update(backupKey, backup);
			await repository.import(state);
			await repository.load(state.intentId);
			await this.context.workspaceState.update(
				`dlc.selection.${hash}`,
				state.intentId,
			);
			await this.context.workspaceState.update(legacyKey, undefined);
		}
	}
	private controller(
		workspace: Workspace,
		intentId: string,
	): Promise<DlcController> {
		let controller = this.controllers.get(intentId);
		if (!controller) {
			controller = workspace.repository
				.load(intentId)
				.then((state) => {
					workspace.repository.assertResumable(state);
					return DlcController.open(
						state,
						new DlcRuntime(
							workspace.repository,
							this.runtime,
							() =>
								workspace.assignments[intentId]?.backend ??
								this.backend,
							async () => {
								const assignment =
									workspace.assignments[intentId];
								if (!assignment) {
									throw new Error(
										"実行先の Worktree を選択してください。",
									);
								}
								const target = await workspace.worktrees.target(
									assignment.targetId,
									this.trust.signal,
								);
								if (!(await this.trust.trusted(target.root))) {
									throw new Error(
										"実行先の Nerita Trust を確認してください。",
									);
								}
								return target.root;
							},
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
	private async refreshEnvironment(workspace: Workspace): Promise<void> {
		await workspace.repository.files.path(".nerita/dlc");
		const branch = await execute(
			"git",
			["-C", workspace.root, "branch", "--show-current"],
			{ windowsHide: true, timeout: 10000, signal: this.trust.signal },
		);
		await workspace.repository.files.path(".nerita/dlc");
		const name = branch.stdout.trim();
		this.environment = {
			workspace: basename(workspace.root),
			branch: name === "" ? null : name,
		};
	}
	private async refreshTargets(workspace: Workspace): Promise<void> {
		this.targets = await Promise.all(
			(await workspace.worktrees.list(this.trust.signal)).map(
				async (target) => ({
					...target,
					directory: target.root,
					trusted: await this.trust.trusted(target.root),
				}),
			),
		).then((targets) =>
			targets.map(
				({
					id,
					directory,
					name,
					branch,
					main,
					removable,
					trusted,
				}) => ({
					id,
					directory,
					name,
					branch,
					main,
					removable,
					trusted,
				}),
			),
		);
		for (const [intentId, assignment] of Object.entries(
			workspace.assignments,
		)) {
			this.targetsForIntent.set(intentId, assignment.targetId);
			this.executionForIntent.set(intentId, assignment);
		}
		this.targetId =
			this.selectedId !== undefined
				? (workspace.assignments[this.selectedId]?.targetId ??
					this.targets.find((target) => target.main)?.id ??
					null)
				: (this.targets.find((target) => target.main)?.id ?? null);
	}
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
	private assertAssignmentReady(intentId: string): void {
		if (this.assigningIntents.has(intentId)) {
			throw new Error(
				"実行先を保存しています。完了後に再試行してください。",
			);
		}
	}
	private async persistAssignment(
		workspace: Workspace,
		intentId: string,
		targetId: string,
		backend: BackendId,
	): Promise<void> {
		const generation = this.generation;
		await workspace.worktrees.target(targetId, this.trust.signal);
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
		if (this.selectedId === intentId) {
			this.targetId = targetId;
			this.backend = backend;
		}
	}

	private async worktreeAction(
		workspace: Workspace,
		message: DlcUiMessage,
	): Promise<boolean> {
		if (message.type === "dlc/trust") {
			await vscode.commands.executeCommand("nerita.trust.manage");
			return true;
		}
		if (message.type === "dlc/worktreeCreate") {
			if (this.runtime.busy()) {
				throw new Error(
					"実行が終わってから Worktree を作成してください。",
				);
			}
			const target = await workspace.repository.locked(() =>
				workspace.worktrees.create(this.trust.signal),
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
						this.trust.signal,
					),
				),
			);
			await this.refreshTargets(workspace);
			this.publish();
			return true;
		}
		if (message.type === "dlc/target") {
			if (
				message.intentId !== this.selectedId ||
				this.selected?.projection().revision !== message.revision
			) {
				throw new Error("Intent の選択または版が変更されています。");
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

	private async restoreSelection(
		workspace: Workspace,
		sequence: number,
	): Promise<void> {
		const selectedId =
			this.selectedId ??
			this.context.workspaceState.get<string>(workspace.selectionKey);
		// 一覧の読み込み中に利用者が選んだ Intent を、自動復元で上書きしない。
		if (
			sequence === this.selectionSequence &&
			selectedId !== undefined &&
			!this.selected
		) {
			await this.select(workspace, selectedId);
		}
	}
	private async presentation(message: DlcUiMessage): Promise<boolean> {
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
			this.runtime.selectMode(message.mode);
			await this.read();
			return true;
		}
		if (message.type === "dlc/read") {
			await this.read();
			return true;
		}
		return this.backendSelection(message);
	}
	private validateBackendSelection(
		message: Extract<DlcUiMessage, { type: "dlc/backend" }>,
	): void {
		if (
			message.intentId !== (this.selectedId ?? null) ||
			message.revision !== (this.selected?.projection().revision ?? null)
		) {
			throw new Error("Intent の選択または版が変更されています。");
		}
		if (
			this.selectedId !== undefined &&
			this.runningIntents.has(this.selectedId)
		) {
			throw new Error(
				"実行が終わってから DLC のバックエンドを変更してください。",
			);
		}
	}
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
		this.publish();
		return true;
	}

	private async read(): Promise<void> {
		if (this.runtime.viewMode() === "chat" && !this.workspace) {
			this.publish();
			return;
		}
		const workspace = await this.open();
		const sequence = this.selectionSequence;
		for (const intentId of this.controllers.keys()) {
			if (!this.runningIntents.has(intentId)) {
				this.controllers.delete(intentId);
			}
		}
		if (!this.runningIntents.has(this.selectedId ?? "")) {
			this.selected = undefined;
		}
		this.intents = (await workspace.repository.projections()).map(
			intentSummary,
		);
		await this.refreshEnvironment(workspace);
		await this.refreshTargets(workspace);
		await this.restoreSelection(workspace, sequence);
		this.publish();
	}
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
	private async restoreAttempt(
		workspace: Workspace,
		controller: DlcController,
		intentId: string,
	): Promise<void> {
		const attempt = controller
			.projection()
			.workItems.flatMap((item) => item.attempts)
			.at(-1);
		if (
			!this.runningIntents.has(intentId) &&
			attempt !== undefined &&
			workspace.repository.hasConversation(intentId, attempt.id)
		) {
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
	private async dispatch(message: DlcUiMessage): Promise<void> {
		if (await this.presentation(message)) {
			return;
		}
		const workspace = await this.open();
		if (await this.worktreeAction(workspace, message)) {
			return;
		}
		if (message.type === "dlc/create") {
			workspace.detection = await workspace.repository.locked(() =>
				initializeWorkspace(
					workspace.repository.files,
					this.trust.signal,
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
			if (this.runningIntents.size > 0) {
				throw new Error(
					"実行が終わってから Intent を復旧してください。",
				);
			}
			await workspace.repository.recoverOrphans();
			this.controllers.clear();
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
	private async attempt(
		workspace: Workspace,
		message: Extract<DlcUiMessage, { type: "dlc/attempt" }>,
	): Promise<void> {
		if (message.intentId !== this.selectedId) {
			throw new Error("Intent が変更されています。");
		}
		const selection = this.runtime.beginAttemptSelection(message.intentId);
		const active = this.runtime.activeDlc();
		if (
			active?.intentId === message.intentId &&
			active.attemptId === message.attemptId
		) {
			this.runtime.selectDlc(message.intentId);
			return;
		}
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
	private async action(
		workspace: Workspace,
		message: Extract<DlcUiMessage, { type: "dlc/action" }>,
	): Promise<void> {
		const controller = await this.controller(workspace, message.intentId);
		if (
			message.revision >= 0 &&
			(message.intentId !== this.selectedId ||
				controller.projection().revision !== message.revision)
		) {
			throw new Error(
				"表示した Intent の版が古くなっています。再読込みしてください。",
			);
		}
		await this.dispatchAction(workspace, controller, message);
		this.publish();
	}
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
				this.trust.signal,
			);
		}
		if (message.action.type !== "run") {
			await controller.dispatch(message.action);
			if (!controller.projection().canCancel) {
				await workspace.repository.exportSnapshot(message.intentId);
			}
			return;
		}
		if (this.runningIntents.has(message.intentId)) {
			throw new Error("この Intent は既に実行中です。");
		}
		this.runningIntents.add(message.intentId);
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
		} finally {
			this.runningIntents.delete(message.intentId);
		}
	}
	async command(
		name: "create" | "plan" | "run" | "cancel" | "status" | "retry",
	): Promise<DlcView> {
		await this.receive({
			type: "ui/setMode",
			requestId: randomUUID(),
			mode: "dlc",
		});
		if (name === "run" || name === "cancel" || name === "retry") {
			const projection = this.selected?.projection();
			if (projection) {
				const item = projection.workItems.find((item) =>
					["failed", "cancelled", "interrupted"].includes(
						item.status,
					),
				);
				const action = commandAction(name, item?.id);
				if (action) {
					await this.receive({
						type: "dlc/action",
						requestId: randomUUID(),
						intentId: projection.intentId,
						revision: projection.revision,
						action,
					});
				}
			}
		}
		await vscode.commands.executeCommand("nerita.dlc.openWorkspace");
		return this.view();
	}
	reset(): Promise<void> {
		this.resetting ??= this.clearWorkspace().finally(() => {
			this.resetting = undefined;
		});
		return this.resetting;
	}
	private async clearWorkspace(): Promise<void> {
		const workspace = this.workspace;
		this.generation++;
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
		this.intents = [];
		this.environment = null;
		this.targets = [];
		this.targetId = null;
		this.targetsForIntent.clear();
		this.executionForIntent.clear();
		this.runtime.selectDlc(undefined);
		this.publish();
	}
	async dispose(): Promise<void> {
		this.closed = true;
		await this.reset();
	}
}

function commandAction(
	name: "run" | "cancel" | "retry",
	workItemId: string | undefined,
): DlcAction | undefined {
	if (name !== "retry") {
		return { type: name };
	}
	return workItemId === undefined ? undefined : { type: "retry", workItemId };
}
