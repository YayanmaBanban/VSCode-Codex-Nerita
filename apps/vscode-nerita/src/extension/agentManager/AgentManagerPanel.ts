// 専用パネルを1つのワークスペースへ固定し、保存前に信頼・文書・世代を再確認する。
import { errorText } from "@nerita/shared/errorText";
import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import {
	managerRequestSchema,
	type ManagerReply,
	type ManagerState,
	type ManagerModel,
} from "@nerita/shared/agentManager/messages";
import type { BackendSession } from "../session/chatSession";
import { configuredBackend } from "../webview/backendSettings";
import { selectLocalWorkspace } from "../webview/selectLocalWorkspace";
import { webviewHtml } from "../webview/webviewHtml";
import { AgentManagerStore } from "./AgentManagerStore";
import { readPiAgents } from "./PiAgentSettings";
import { generation, readWorkspaceFile } from "./WorkspaceFiles";
import { agentModelReader, type AgentModelReader } from "./AgentModelCatalog";
import { credentialService } from "../credentials/CredentialService";

/** パネルを閉じた後のキューは保存しない。 */
export class AgentManagerPanel {
	private closed = false;
	private queue = Promise.resolve();
	private readonly workspace: string;
	private readonly store: AgentManagerStore;
	private readonly abort = new AbortController();
	private catalogs: Record<"pi" | "codex", ManagerModel[]> = {
		pi: [],
		codex: [],
	};
	private modelErrors: string[] = [];
	constructor(
		private folder: vscode.WorkspaceFolder,
		root: string,
		private panel: vscode.WebviewPanel,
		private backend: BackendSession,
		extensionPath: string,
		private readModels: AgentModelReader = agentModelReader(
			extensionPath,
			root,
		),
	) {
		this.workspace = generation(root);
		this.store = new AgentManagerStore(
			root,
			async () =>
				readPiAgents(
					extensionPath,
					root,
					vscode.workspace.isTrusted,
					await readWorkspaceFile(root, ".pi/settings.json"),
				),
			(id) => this.models(id),
			configuredBackend,
		);
	}
	private liveModels(id: "pi" | "codex") {
		const state = this.backend.snapshot();
		return configuredBackend() === id && state.connection === "ready"
			? (this.backend.agentModels?.() ?? [])
			: [];
	}
	/** 取得済みのモデル候補を、表示と保存時の検証で共用する。 */
	private models(id: "pi" | "codex") {
		return this.catalogs[id];
	}
	/** 使用中のバックエンドのモデル候補を取得し、失敗した場合はエラーを表示する。 */
	private async refreshModels() {
		this.modelErrors = [];
		if (!vscode.workspace.isTrusted) {
			this.catalogs = { pi: [], codex: [] };
			return;
		}
		await Promise.all(
			[configuredBackend()].map(async (id) => {
				try {
					const live = this.liveModels(id);
					this.catalogs[id] =
						live.length > 0 &&
						live.every((model) => model.efforts !== undefined)
							? live
							: await this.readModels(id, this.abort.signal);
					if (this.catalogs[id].length === 0) {
						this.modelErrors.push(
							`${id}: モデル一覧を取得できません。認証設定を確認して再読み込みしてください。`,
						);
					}
				} catch {
					this.catalogs[id] = [];
					this.modelErrors.push(
						`${id}: モデル一覧の取得に失敗しました。再読み込みしてください。`,
					);
				}
			}),
		);
	}
	close() {
		this.closed = true;
		this.abort.abort();
	}
	private post(message: ManagerReply) {
		if (!this.closed) {
			void this.panel.webview.postMessage(message);
		}
	}
	async publish(refreshModels = true) {
		if (refreshModels) {
			await this.refreshModels();
		}
		const { files: _files, ...data } = await this.store.read();
		const state = this.backend.snapshot();
		const sameWorkspace =
			state.cwd !== null &&
			(await realpath(state.cwd).catch(() => "")) === this.store.root;
		this.post({
			...data,
			errors: [...data.errors, ...this.modelErrors],
			type: "state",
			workspace: this.workspace,
			label: this.store.root,
			activeBackend: configuredBackend(),
			currentModels: {
				[configuredBackend()]: state.configOptions.find(
					(item) => item.id === "model",
				)?.currentValue,
			},
			models: { pi: this.models("pi"), codex: this.models("codex") },
			running: sameWorkspace
				? state.agents.filter((agent) =>
						["running", "pendingInit"].includes(agent.status),
					).length
				: 0,
			spawned: sameWorkspace ? state.agents.length : 0,
		} satisfies ManagerState);
	}
	/** 保存は直列化し、バックエンドの応答待ちで別要求を追い越させない。 */
	receive(value: unknown) {
		const parsed = managerRequestSchema.safeParse(value);
		if (!parsed.success || this.closed) {
			return;
		}
		const request = parsed.data;
		this.queue = this.queue.then(async () => {
			if (this.closed) {
				return;
			}
			try {
				if (request.type === "viewer") {
					await vscode.commands.executeCommand(
						"nerita.codex.chat.focus",
					);
					return;
				}
				if ("generation" in request) {
					if (request.workspace !== this.workspace) {
						throw new Error(
							"保存先のワークスペースが一致しません。",
						);
					}
					await this.refreshModels();
					await this.store.save(request, () => this.assertWritable());
					await this.publish(false);
					this.post({
						type: "reply",
						id: request.id,
						error: null,
						notice:
							request.type === "handoff"
								? "ハンドオフ設定を保存しました。"
								: "Agent 設定を保存しました。",
					});
				} else {
					await this.publish();
				}
			} catch (error) {
				this.post({
					type: "reply",
					id: "id" in request ? request.id : 0,
					error: errorText(error),
					notice: "",
				});
			}
		});
	}
	/** 未保存のエディタ内容や除外済みワークスペースを上書きしない。 */
	private assertWritable() {
		if (
			this.closed ||
			!vscode.workspace.isTrusted ||
			!(
				vscode.workspace.workspaceFolders?.some(
					(item) =>
						item.uri.toString() === this.folder.uri.toString(),
				) === true
			)
		) {
			throw new Error("信頼済みのワークスペースを開いてください。");
		}
		for (const document of vscode.workspace.textDocuments) {
			if (
				!document.isDirty ||
				vscode.workspace
					.getWorkspaceFolder(document.uri)
					?.uri.toString() !== this.folder.uri.toString()
			) {
				continue;
			}
			const relative = vscode.workspace
				.asRelativePath(document.uri, false)
				.replaceAll("\\", "/");
			if (
				/^(?:\.pi\/settings\.json|\.pi\/agents\/.+\.md|\.codex\/agents\/[^/]+\.toml|\.nerita\/handoff(?:\.schema)?\.json)$/.test(
					relative,
				)
			) {
				throw new Error(
					"設定ファイルに未保存の編集があります。エディタで保存してから再読み込みしてください。",
				);
			}
		}
	}
}

/** 同じワークスペースの管理画面を再利用し、別ルートへ保存しない。 */
export function registerAgentManager(
	context: vscode.ExtensionContext,
	backend: BackendSession,
) {
	const panels = new Map<string, vscode.WebviewPanel>();
	context.subscriptions.push(
		vscode.commands.registerCommand("nerita.agents.manage", async () => {
			try {
				const selected = await selectLocalWorkspace();
				if (!selected) {
					return;
				}
				const { folder, root } = selected;
				const existing = panels.get(root);
				if (existing) {
					existing.reveal();
					return;
				}
				const panel = vscode.window.createWebviewPanel(
					"nerita.agents",
					`Agent Manager — ${folder.name}`,
					vscode.ViewColumn.Active,
					{
						enableScripts: true,
						localResourceRoots: [
							vscode.Uri.joinPath(
								context.extensionUri,
								"dist/webview",
							),
						],
					},
				);
				panels.set(root, panel);
				const host = new AgentManagerPanel(
					folder,
					root,
					panel,
					backend,
					context.extensionPath,
					agentModelReader(
						context.extensionPath,
						root,
						credentialService(context).piStore(),
					),
				);
				const receive = panel.webview.onDidReceiveMessage(
					(value: unknown) => host.receive(value),
				);
				panel.onDidDispose(() => {
					host.close();
					receive.dispose();
					panels.delete(root);
				});
				panel.webview.html = webviewHtml(
					panel.webview,
					context.extensionUri,
					"agent-manager",
				);
				context.subscriptions.push(panel);
			} catch (error) {
				void vscode.window.showErrorMessage(errorText(error));
			}
		}),
	);
}
