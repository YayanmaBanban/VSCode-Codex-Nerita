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
import type { ChatState } from "@nerita/shared/chatState";
import { configuredBackend } from "../webview/backendSettings";
import { selectLocalWorkspace } from "../webview/selectLocalWorkspace";
import { webviewHtml } from "../webview/webviewHtml";
import { AgentManagerStore } from "./AgentManagerStore";
import { readManagerDraft, writeManagerDraft } from "./AgentManagerDraft";
import { readPiAgents } from "./PiAgentSettings";
import { generation, readWorkspaceFile } from "./WorkspaceFiles";
import {
	agentModelReader,
	currentAgentModel,
	type AgentModelReader,
} from "./AgentModelCatalog";
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
	private readonly configuration: vscode.Disposable;
	private readonly unsubscribeBackend: () => void;
	private connectedBackend: string | undefined;
	private connectedOptions = "";
	/** 管理画面を作業ルートとバックエンドへ結び付け、モデル候補の取得経路も同じルートに固定する。 */
	constructor(
		private folder: vscode.WorkspaceFolder,
		root: string,
		private panel: { webview: Pick<vscode.Webview, "postMessage"> },
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
		const initial = backend.snapshot();
		this.connectedBackend =
			initial.connection === "ready"
				? initial.uiContributions?.surface
				: undefined;
		this.connectedOptions = this.modelSignature(initial);
		this.configuration = vscode.workspace.onDidChangeConfiguration(
			(event) => {
				if (event.affectsConfiguration("nerita.backend")) {
					this.receive({ type: "reload" });
				}
			},
		);
		this.unsubscribeBackend = backend.subscribe(() =>
			this.backendChanged(),
		);
	}
	/** 接続先やモデル・推論候補の変更時だけ管理画面を更新し、通常の会話通知で編集内容を消さない。 */
	private backendChanged() {
		const state = this.backend.snapshot();
		if (state.connection !== "ready") {
			this.connectedBackend = undefined;
			this.connectedOptions = "";
			return;
		}
		const surface = state.uiContributions?.surface;
		const options = this.modelSignature(state);
		const changed =
			surface !== this.connectedBackend ||
			options !== this.connectedOptions;
		if (changed) {
			this.connectedBackend = surface;
			this.connectedOptions = options;
			this.receive({ type: "reload" });
		}
	}
	/** 接続後に遅れて届くモデル・推論候補を区別し、応答本文や推論の選択値は更新契機にしない。 */
	private modelSignature(state: ChatState) {
		return JSON.stringify(
			state.configOptions
				.filter((option) =>
					["model", "reasoning_effort"].includes(option.id),
				)
				.map((option) => ({
					id: option.id,
					model:
						option.id === "model" ? option.currentValue : undefined,
					options: option.options,
				})),
		);
	}
	/** 選択バックエンドの接続が完了している場合だけ、現在の会話のモデル候補を使う。 */
	private liveModels(id: "pi" | "codex") {
		const state = this.backend.snapshot();
		const matchesBackend = state.uiContributions?.surface === id;
		const live =
			matchesBackend &&
			configuredBackend() === id &&
			state.connection === "ready";
		if (!live) {
			return [];
		}
		return this.backend.agentModels?.() ?? [];
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
	/** 画面を閉じた後の取得を取り消し、遅い結果を Webview へ送らないようにする。 */
	close() {
		this.closed = true;
		this.abort.abort();
		this.configuration.dispose();
		this.unsubscribeBackend();
	}
	/** 破棄済みの管理画面には非同期の結果を配信しない。 */
	private post(message: ManagerReply) {
		if (!this.closed) {
			void this.panel.webview.postMessage(message);
		}
	}
	/** 保存済み設定とモデル候補を公開し、実行中の子の件数は同じ実体ルートの会話だけを数える。 */
	async publish(refreshModels = true) {
		const activeBackend = configuredBackend();
		if (refreshModels) {
			await this.refreshModels();
		}
		const { files: _files, ...data } = await this.store.read();
		let draft = null;
		let draftError: string | null = null;
		try {
			draft = await readManagerDraft(this.store.root, activeBackend);
		} catch (error) {
			draftError = `下書きを読み込めません: ${errorText(error)}`;
		}
		const state = this.backend.snapshot();
		const sameWorkspace =
			state.cwd !== null &&
			(await realpath(state.cwd).catch(() => "")) === this.store.root;
		if (activeBackend !== configuredBackend()) {
			return;
		}
		this.post({
			...data,
			draft,
			draftError,
			errors: [...data.errors, ...this.modelErrors],
			type: "state",
			workspace: this.workspace,
			label: this.store.root,
			activeBackend,
			...(state.uiContributions?.surface === activeBackend
				? currentAgentModel(state, activeBackend)
				: {}),
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
		/** 要求を待機列の順に処理し、保存先と、設定保存の場合は世代も確認して結果を返信する。 */
		const handleManagerRequest = async () => {
			if (this.closed) {
				return;
			}
			try {
				if (request.type === "draft") {
					if (request.workspace !== this.workspace) {
						throw new Error(
							"保存先のワークスペースが一致しません。",
						);
					}
					await writeManagerDraft(
						this.store.root,
						configuredBackend(),
						request.draft,
						() => this.assertDraftWritable(),
					);
					this.post({
						type: "reply",
						id: request.id,
						error: null,
						notice: "下書きを保存しました。",
					});
					return;
				}
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
		};
		this.queue = this.queue.then(handleManagerRequest);
	}
	/** 未保存のエディタ内容や除外済みワークスペースを上書きしない。 */
	private assertWritable() {
		if (this.closed) {
			throw new Error("信頼済みのワークスペースを開いてください。");
		}
		if (!vscode.workspace.isTrusted) {
			throw new Error("信頼済みのワークスペースを開いてください。");
		}
		const workspaceWasRemoved = !(
			vscode.workspace.workspaceFolders?.some(
				(item) => item.uri.toString() === this.folder.uri.toString(),
			) === true
		);
		if (workspaceWasRemoved) {
			throw new Error("信頼済みのワークスペースを開いてください。");
		}
		for (const document of vscode.workspace.textDocuments) {
			if (!document.isDirty) {
				continue;
			}
			const documentIsOutsideWorkspace =
				vscode.workspace
					.getWorkspaceFolder(document.uri)
					?.uri.toString() !== this.folder.uri.toString();
			if (documentIsOutsideWorkspace) {
				continue;
			}
			const relative = vscode.workspace
				.asRelativePath(document.uri, false)
				.replaceAll("\\", "/");
			const matchesTest =
				/^(?:\.pi\/settings\.json|\.pi\/agents\/.+\.md|\.codex\/agents\/[^/]+\.toml|\.nerita\/handoff(?:\.schema)?\.json)$/.test(
					relative,
				);
			if (matchesTest) {
				throw new Error(
					"設定ファイルに未保存の編集があります。エディタで保存してから再読み込みしてください。",
				);
			}
		}
	}
	/** 設定の未保存バッファがあっても退避できるよう、下書き自身の書き込み条件だけを確認する。 */
	private assertDraftWritable() {
		const present =
			vscode.workspace.workspaceFolders?.some(
				(item) => item.uri.toString() === this.folder.uri.toString(),
			) === true;
		const unavailable =
			this.closed || !vscode.workspace.isTrusted || !present;
		if (unavailable) {
			throw new Error("信頼済みのワークスペースを開いてください。");
		}
		const relative = `.nerita/agent-manager-draft-${configuredBackend()}.json`;
		const dirtyDraft = vscode.workspace.textDocuments.some(
			(document) =>
				document.isDirty &&
				vscode.workspace
					.getWorkspaceFolder(document.uri)
					?.uri.toString() === this.folder.uri.toString() &&
				vscode.workspace
					.asRelativePath(document.uri, false)
					.replaceAll("\\", "/") === relative,
		);
		if (dirtyDraft) {
			throw new Error(
				"下書きファイルに未保存の編集があります。エディタで保存してください。",
			);
		}
	}
}

/** 同じワークスペースの管理画面を再利用し、別ルートへ保存しない。 */
export function registerAgentManager(
	context: vscode.ExtensionContext,
	backend: BackendSession,
) {
	const panels = new Map<string, vscode.WebviewPanel>();
	/** 選択したルートの管理画面を1つだけ開き、破棄時に購読と登録を回収する。 */
	const openAgentManager = async () => {
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
	};
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"nerita.agents.manage",
			openAgentManager,
		),
	);
}
