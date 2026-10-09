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

const execute = promisify(execFile);

type Workspace = {
	root: string;
	repository: IntentRepository;
	detection: WorkspaceDetection;
	selectionKey: string;
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
	private runningIntent: string | undefined;
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
		let execution = "";
		const unsubscribe = runtime.subscribe((event) => {
			if (
				event.type !== "state/snapshot" &&
				event.type !== "state/patch"
			) {
				return;
			}
			const active = runtime.activeDlc();
			const key = `${active?.intentId}:${active?.attemptId}:${runtime.dlcPrompt()?.attemptId}`;
			if (execution !== key) {
				execution = key;
				this.publish();
			}
		});
		context.subscriptions.push({ dispose: unsubscribe });
	}
	view(): DlcView {
		return {
			mode: this.runtime.viewMode(),
			backend: this.backend,
			intents: this.intents,
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
	private open(): Promise<Workspace> {
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
		const repository = new IntentRepository(files, {
			read: (key) => this.context.globalState.get(key),
			write: async (key, value) => {
				await this.context.globalState.update(key, value);
			},
		});
		const hash = createHash("sha256").update(root).digest("hex");
		await this.migrateGoal(repository, detection, hash);
		return {
			root,
			repository,
			detection,
			selectionKey: `dlc.selection.${hash}`,
		};
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
							() => this.backend,
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
			this.runtime.selectMode("dlc");
			await vscode.commands.executeCommand("nerita.codex.chat.focus");
			this.publish();
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
		if (message.type === "dlc/backend") {
			if (this.runningIntent !== undefined) {
				throw new Error(
					"実行が終わってから DLC のバックエンドを変更してください。",
				);
			}
			this.backend = message.backend;
			await this.context.globalState.update(
				"dlc.backend",
				message.backend,
			);
			this.publish();
			return true;
		}
		return false;
	}

	private async read(): Promise<void> {
		if (this.runtime.viewMode() === "chat" && !this.workspace) {
			this.publish();
			return;
		}
		const workspace = await this.open();
		const sequence = this.selectionSequence;
		for (const intentId of this.controllers.keys()) {
			if (intentId !== this.runningIntent) {
				this.controllers.delete(intentId);
			}
		}
		if (this.selectedId !== this.runningIntent) {
			this.selected = undefined;
		}
		this.intents = (await workspace.repository.projections()).map(
			intentSummary,
		);
		await this.refreshEnvironment(workspace);
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
		this.runtime.selectDlc(intentId);
		const attempt = controller
			.projection()
			.workItems.flatMap((item) => item.attempts)
			.at(-1);
		if (
			this.runningIntent !== intentId &&
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
			await this.read();
			return;
		}
		if (message.type === "dlc/recover") {
			if (this.runningIntent !== undefined) {
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
			await collectSourceSnapshot(workspace.root, this.trust.signal);
		}
		if (message.action.type !== "run") {
			await controller.dispatch(message.action);
			return;
		}
		if (this.runningIntent !== undefined) {
			throw new Error("別の DLC 実行が進行中です。");
		}
		this.runningIntent = message.intentId;
		try {
			this.runtime.selectMode("dlc");
			await vscode.commands.executeCommand("nerita.codex.chat.focus");
			await controller.dispatch(message.action);
		} finally {
			this.runningIntent = undefined;
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
	async reset(): Promise<void> {
		this.generation++;
		this.selectionSequence++;
		const active = this.runtime.activeDlc();
		if (active) {
			await this.runtime.stopDlc(active.attemptId);
		}
		this.workspace = undefined;
		this.controllers.clear();
		this.selected = undefined;
		this.selectedId = undefined;
		this.intents = [];
		this.environment = null;
		this.runtime.selectDlc(undefined);
		this.publish();
	}
	async dispose(): Promise<void> {
		await this.reset();
		this.closed = true;
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
