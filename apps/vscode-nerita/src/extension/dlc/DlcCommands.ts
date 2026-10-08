// コマンドパレットの入力を DLC の操作契約へ渡し、表示と永続化を Host で担当する。
import * as vscode from "vscode";
import { randomUUID, createHash } from "node:crypto";
import { DlcController } from "@nerita/dlc/controller";
import { createProject } from "@nerita/dlc/state";
import {
	DlcTaskSchema,
	DlcProjectionSchema,
	type DlcTask,
} from "@nerita/shared/dlc/contracts";
import { errorText } from "@nerita/shared/errorText";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import { createBackend } from "../backends/createBackend";
import { requireLocalWorkspace } from "../workspace";
import { SessionRuntime } from "./SessionRuntime";
import { promptDlcApproval } from "./DlcApprovalPrompt";

/** 認証・モデル設定は既存の Nerita 設定を使い、DLC に複製しない。 */
export function registerDlcCommands(
	context: vscode.ExtensionContext,
	trust: WorkspaceTrustStore,
): { dispose(): Promise<void> } {
	const host = new DlcHost(context, trust);
	const commands = [
		["create", host.create.bind(host)],
		["plan", host.plan.bind(host)],
		["run", host.run.bind(host)],
		["cancel", host.cancel.bind(host)],
		["status", host.status.bind(host)],
		["retry", host.retry.bind(host)],
	] as const;
	for (const [name, operation] of commands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`nerita.dlc.${name}`, () =>
				host.show(operation),
			),
		);
	}
	context.subscriptions.push(
		host.output,
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void host.reset();
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("nerita")) {
				void host.show(host.cancel.bind(host));
			}
		}),
		{
			dispose: trust.onChange(() => {
				void host.show(host.cancel.bind(host));
			}),
		},
	);
	return { dispose: host.dispose.bind(host) };
}

/** 設定変更と終了時にも、同じコントローラーの停止経路を使う。 */
class DlcHost {
	readonly output = vscode.window.createOutputChannel("Nerita DLC");
	private loaded: Promise<DlcController> | undefined;
	private controller: DlcController | undefined;
	private generation = 0;
	private resetting = false;
	private closed = false;
	constructor(
		private context: vscode.ExtensionContext,
		private trust: WorkspaceTrustStore,
	) {}
	private load(goal?: string): Promise<DlcController> {
		if (this.resetting || this.closed) {
			throw new Error("DLC の接続先を変更中、または終了しています。");
		}
		const generation = this.generation;
		this.loaded ??= openController(this.context, this.trust, goal)
			.then((value) => {
				this.assertCurrent(generation);
				this.controller = value;
				return value;
			})
			.catch((error: unknown) => {
				if (this.generation === generation) {
					this.loaded = undefined;
				}
				throw error;
			});
		return this.loaded;
	}
	async create() {
		const goal = await vscode.window.showInputBox({
			title: "DLC: プロジェクトの目標",
			ignoreFocusOut: true,
		});
		if (goal === undefined || goal.trim() === "") {
			return undefined;
		}
		return (await this.load(goal)).projection();
	}
	async plan() {
		const dlc = await this.load();
		const generation = this.generation;
		if (dlc.projection().stage !== "planning") {
			throw new Error("プランは既に確定しています。");
		}
		const tasks: DlcTask[] = [];
		while (tasks.length < 50) {
			const task = await promptTask();
			if (task === undefined) {
				return undefined;
			}
			tasks.push(task);
			const choice = await vscode.window.showQuickPick(
				["このプランを登録", "作業を追加"],
				{ title: `DLC: ${tasks.length}件の作業` },
			);
			if (choice === undefined) {
				return undefined;
			}
			if (choice === "このプランを登録") {
				this.assertCurrent(generation);
				return dlc.dispatch({ type: "plan", tasks });
			}
		}
		throw new Error("プランに登録できる作業は50件までです。");
	}
	async run() {
		const dlc = await this.load();
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "DLC: 作業を実行中",
				cancellable: true,
			},
			async (_progress, token) => {
				const listener = token.onCancellationRequested(() => {
					void this.show(this.cancel.bind(this));
				});
				try {
					return await dlc.dispatch({ type: "run" });
				} finally {
					listener.dispose();
				}
			},
		);
	}
	async retry() {
		const dlc = await this.load();
		const generation = this.generation;
		const items = dlc
			.projection()
			.workItems.filter((item) =>
				["failed", "cancelled", "interrupted"].includes(item.status),
			)
			.map((item) => ({ label: item.title, id: item.id }));
		const item = await vscode.window.showQuickPick(items, {
			title: "DLC: 再試行する作業",
		});
		this.assertCurrent(generation);
		return item
			? dlc.dispatch({ type: "retry", workItemId: item.id })
			: undefined;
	}
	async status() {
		return (await this.load()).projection();
	}
	async cancel(): Promise<void> {
		await this.controller?.dispatch({ type: "cancel" });
	}
	async reset() {
		const generation = ++this.generation;
		this.resetting = true;
		await this.show(this.cancel.bind(this));
		if (generation === this.generation) {
			this.loaded = undefined;
			this.controller = undefined;
			this.resetting = false;
		}
	}
	private assertCurrent(generation: number) {
		if (this.generation !== generation || this.closed) {
			throw new Error("DLC の作業ワークスペースが変更されました。");
		}
	}
	async dispose(): Promise<void> {
		this.closed = true;
		this.generation += 1;
		await this.cancel();
	}
	async show(operation: () => Promise<unknown>) {
		try {
			const value = await operation();
			if (value === undefined) {
				return;
			}
			const view = DlcProjectionSchema.parse(value);
			this.output.appendLine(
				[
					`目標: ${view.goal}`,
					`段階: ${view.stage}`,
					...view.workItems.map(
						(item) =>
							`${item.title}: ${item.status}（実行 ${item.attemptCount}回）${item.detail === null ? "" : `\n  ${item.detail}`}`,
					),
				].join("\n"),
			);
			this.output.show(true);
		} catch (error) {
			await vscode.window.showErrorMessage(`DLC: ${errorText(error)}`);
		}
	}
}

async function promptTask(): Promise<DlcTask | undefined> {
	const title = await vscode.window.showInputBox({
		title: "DLC: 作業名",
		ignoreFocusOut: true,
	});
	if (title === undefined) {
		return undefined;
	}
	const instructions = await vscode.window.showInputBox({
		title: "DLC: 実装する内容",
		ignoreFocusOut: true,
	});
	if (instructions === undefined) {
		return undefined;
	}
	const paths = await vscode.window.showInputBox({
		title: "DLC: 対象ファイル",
		prompt: "ワークスペースからの相対パスをカンマで区切って指定してください。",
		ignoreFocusOut: true,
	});
	if (paths === undefined) {
		return undefined;
	}
	return DlcTaskSchema.parse({
		title,
		instructions,
		paths: paths
			.split(",")
			.map((path) => path.trim().replaceAll("\\", "/")),
	});
}

async function openController(
	context: vscode.ExtensionContext,
	trust: WorkspaceTrustStore,
	goal: string | undefined,
): Promise<DlcController> {
	const folders = vscode.workspace.workspaceFolders;
	if (folders?.length !== 1) {
		throw new Error(
			"DLC は1つのローカルワークスペースで実行してください。",
		);
	}
	const root = requireLocalWorkspace(
		folders,
		vscode.workspace.isTrusted,
		vscode.env.remoteName,
	);
	const key = `dlc.project.${createHash("sha256").update(root).digest("hex")}`;
	const saved: unknown = context.workspaceState.get(key);
	if (saved === undefined && goal === undefined) {
		throw new Error("先に DLC のプロジェクトを作成してください。");
	}
	const state = saved ?? createProject(randomUUID(), goal ?? "");
	const runtime = new SessionRuntime(
		root,
		() => {
			requireLocalWorkspace(
				vscode.workspace.workspaceFolders,
				vscode.workspace.isTrusted,
				vscode.env.remoteName,
			);
			return createBackend(context, trust);
		},
		promptDlcApproval,
	);
	return DlcController.open(
		state,
		runtime,
		{
			save: async (value) => {
				await context.workspaceState.update(key, value);
			},
		},
		randomUUID,
	);
}
