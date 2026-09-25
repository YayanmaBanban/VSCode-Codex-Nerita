// Custom Text Editor を通常のエディタグループへ登録し、検査・保存・適用を分離する。
import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import {
	defaultGuardrails,
	parseGuardrails,
} from "../../../../shared/guardrails/config";
import {
	guardRequestSchema,
	type GuardRequest,
	type GuardReply,
} from "../../../../shared/guardrails/messages";
import {
	evaluateGuardrails,
	guardrailWarnings,
} from "../../../security/GuardrailEvaluator";
import { guardrailRegistry } from "../../../security/GuardrailRegistry";
import { webviewHtml } from "../../../webview/webviewHtml";
import { GuardrailsSettings } from "./GuardrailsSettings";

export const guardrailsViewType = "nerita.pi.guardrails";

/** 各パネルは自身の文書だけを変更し、受信メッセージにファイルパスを指定させない。 */
class GuardrailsEditor implements vscode.CustomTextEditorProvider {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly settings: GuardrailsSettings,
	) {}
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
	): Promise<void> {
		const root = await this.settings.rootFor(document.uri);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, "dist/webview"),
			],
		};
		panel.webview.html = webviewHtml(
			panel.webview,
			this.context.extensionUri,
			"pi-guardrails",
		);
		const post = (message: GuardReply) => {
			void panel.webview.postMessage(message);
		};
		const publish = () => {
			const active = guardrailRegistry.snapshot(root, [root]);
			post({
				type: "state",
				text: document.getText(),
				version: document.version,
				dirty: document.isDirty,
				root,
				activeText: active.signal.aborted
					? ""
					: JSON.stringify(active.config, null, 2),
			});
		};
		let queue: Promise<void> = Promise.resolve();
		const listeners = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					publish();
				}
			}),
			vscode.workspace.onDidSaveTextDocument((saved) => {
				if (saved.uri.toString() === document.uri.toString()) {
					publish();
				}
			}),
			panel.webview.onDidReceiveMessage((value: unknown) => {
				const parsed = guardRequestSchema.safeParse(value);
				if (!parsed.success) {
					return;
				}
				queue = queue
					.then(async () => {
						const message = parsed.data;
						if (message.type === "ready") {
							publish();
							return;
						}
						try {
							await this.settings.rootFor(document.uri);
							if (message.version !== document.version) {
								throw new Error(
									"別の編集が反映されています。最新の内容を確認してください。",
								);
							}
							await this.handle(
								message,
								document,
								root,
								(reply) => {
									publish();
									post(reply);
								},
							);
						} catch (error) {
							publish();
							post({
								type: "reply",
								id: message.id,
								error:
									error instanceof Error
										? error.message
										: "操作に失敗しました。",
								notice: "",
								result: null,
								warnings: [],
							});
						}
					})
					.catch(() => undefined);
			}),
		];
		panel.onDidDispose(() =>
			listeners.forEach((listener) => {
				listener.dispose();
			}),
		);
	}
	/** 検査には現在の文書を使い、適用には保存済みの同じ世代を要求する。 */
	private async handle(
		message: Exclude<GuardRequest, { type: "ready" }>,
		document: vscode.TextDocument,
		root: string,
		post: (message: GuardReply) => void,
	) {
		let notice = "";
		let result: Extract<GuardReply, { type: "reply" }>["result"] = null;
		let warnings: string[] = [];
		if (message.type === "edit") {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				document.uri,
				new vscode.Range(0, 0, document.lineCount, 0),
				message.text,
			);
			if (!(await vscode.workspace.applyEdit(edit))) {
				throw new Error("文書を更新できませんでした。");
			}
		} else {
			const text = document.getText();
			const config = parseGuardrails(text);
			warnings = guardrailWarnings(config);
			if (message.type === "save") {
				if (!(await document.save())) {
					throw new Error("保存できませんでした。");
				}
				notice = "保存しました。実行に反映するには適用してください。";
			} else if (message.type === "apply") {
				if (document.isDirty) {
					throw new Error("適用前に保存してください。");
				}
				await this.settings.apply(
					root,
					text,
					() =>
						!document.isDirty &&
						document.version === message.version &&
						document.getText() === text,
				);
				notice = "適用しました。変更前の承認は失効しました。";
			} else {
				const roots = await Promise.all(
					(vscode.workspace.workspaceFolders ?? [])
						.filter((folder) => folder.uri.scheme === "file")
						.map((folder) => realpath(folder.uri.fsPath)),
				);
				result = await evaluateGuardrails(
					config,
					root,
					roots,
					message.probe,
				);
				notice = "設定と入力例を検査しました。操作は実行していません。";
			}
		}
		post({
			type: "reply",
			id: message.id,
			error: null,
			notice,
			result,
			warnings,
		});
	}
}

/** コマンドからルートを選び、既存ファイルを維持して専用エディターを開く。 */
export async function registerGuardrailsEditor(
	context: vscode.ExtensionContext,
) {
	const settings = new GuardrailsSettings(context.workspaceState);
	await settings.restore();
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			guardrailsViewType,
			new GuardrailsEditor(context, settings),
			{ supportsMultipleEditorsPerDocument: false },
		),
		vscode.commands.registerCommand("nerita.pi.guardrails", async () => {
			const folders = vscode.workspace.workspaceFolders ?? [];
			const folder =
				folders.length === 1
					? folders[0]
					: await vscode.window.showWorkspaceFolderPick();
			if (!folder) {
				return;
			}
			try {
				const uri = vscode.Uri.joinPath(
					folder.uri,
					".pi",
					"guardrails.json",
				);
				await settings.rootFor(uri);
				try {
					await vscode.workspace.fs.stat(uri);
				} catch (error) {
					if (
						!(error instanceof vscode.FileSystemError) ||
						error.code !== "FileNotFound"
					) {
						throw error;
					}
					const edit = new vscode.WorkspaceEdit();
					edit.createFile(uri, {
						overwrite: false,
						ignoreIfExists: false,
						contents: Buffer.from(
							`${JSON.stringify(defaultGuardrails(), null, 2)}\n`,
						),
					});
					if (!(await vscode.workspace.applyEdit(edit))) {
						throw new Error(
							"設定ファイルを作成できませんでした。",
							{ cause: error },
						);
					}
				}
				await vscode.commands.executeCommand(
					"vscode.openWith",
					uri,
					guardrailsViewType,
				);
			} catch (error) {
				void vscode.window.showErrorMessage(String(error));
			}
		}),
		{ dispose: () => guardrailRegistry.dispose() },
	);
	return settings;
}
