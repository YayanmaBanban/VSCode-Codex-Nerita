// Custom Text Editor を登録し、明示的な保存操作で検証済み文書を保存して実行へ適用する。
import { errorText } from "@nerita/shared/errorText";

import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import {
	guardRequestSchema,
	type GuardRequest,
	type GuardReply,
} from "@nerita/shared/guardrails/messages";
import {
	evaluateGuardrails,
	guardrailWarnings,
} from "../../../security/GuardrailEvaluator";
import { guardrailRegistry } from "../../../security/GuardrailRegistry";
import { webviewHtml } from "../../../webview/webviewHtml";
import { replyHostPresentation } from "../../../webview/hostPresentation";
import { GuardrailsSettings } from "./GuardrailsSettings";
import { saveGuardrails } from "./saveGuardrails";
import { discardGuardrails } from "./discardGuardrails";
import { selectedDirectory } from "./selectedDirectory";

export const guardrailsViewType = "nerita.pi.guardrails";

/** 各パネルは自身の文書だけを変更し、受信メッセージにファイルパスを指定させない。 */
class GuardrailsEditor implements vscode.CustomTextEditorProvider {
	/** 設定編集の保存と Webview の生成には、同じ拡張コンテキストを使う。 */
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly settings: GuardrailsSettings,
	) {}
	/** 対象ルートの文書と有効設定を画面へ公開し、保存要求を直列化して編集状態と適用状態を分ける。 */
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
		/** ガードレールの応答を、対応する編集画面へ送信する。 */
		const post = (message: GuardReply) => {
			void panel.webview.postMessage(message);
		};
		/** 編集中の文書と適用中の設定を別の値として通知し、保存状態を実行への適用と混同しない。 */
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
				if (replyHostPresentation(panel.webview, value)) {
					return;
				}
				const parsed = guardRequestSchema.safeParse(value);
				if (!parsed.success) {
					return;
				}
				queue = queue
					.then(
						this.createRequestHandler(
							parsed,
							document,
							root,
							publish,
							post,
						),
					)
					.catch(() => undefined);
			}),
		];
		panel.onDidDispose(() =>
			listeners.forEach((listener) => {
				listener.dispose();
			}),
		);
	}
	/** 検査には現在の文書を使い、保存成功後も同じ世代の内容だけを実行へ適用する。 */
	private async handle(
		message: Exclude<GuardRequest, { type: "ready" }>,
		document: vscode.TextDocument,
		root: string,
		post: (message: GuardReply) => void,
	) {
		let notice = "";
		let result: Extract<GuardReply, { type: "reply" }>["result"] = null;
		let warnings: string[] = [];
		let directory: string | null | undefined;
		if (message.type === "select-directory") {
			directory = await this.pickDirectory(
				document,
				message.version,
				root,
			);
		} else if (message.type === "discard") {
			await this.discard(document, message.version, root);
		} else if (message.type === "edit") {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				document.uri,
				new vscode.Range(0, 0, document.lineCount, 0),
				message.text,
			);
			const matchesValue = !(await vscode.workspace.applyEdit(edit));
			if (matchesValue) {
				throw new Error("文書を更新できませんでした。");
			}
		} else {
			const text = document.getText();
			if (message.type === "save") {
				const config = await saveGuardrails(
					document,
					message.version,
					async (savedText, isCurrent) => {
						await this.settings.rootFor(document.uri);
						await this.settings.apply(root, savedText, isCurrent);
					},
				);
				warnings = guardrailWarnings(config);
				notice =
					"保存して適用しました。以前に承認した操作は、新しい設定でもう一度承認する必要があります。";
			} else {
				const config = parseGuardrails(text);
				warnings = guardrailWarnings(config);
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
			}
		}
		post({
			type: "reply",
			id: message.id,
			error: null,
			notice,
			result,
			warnings,
			...(directory !== undefined ? { directory } : {}),
		});
	}

	/** 復元元は実行側から取得し、Webview が指定した本文で上書きさせない。 */
	private async discard(
		document: vscode.TextDocument,
		version: number,
		root: string,
	) {
		const active = guardrailRegistry.snapshot(root, [root]);
		await discardGuardrails(
			document,
			version,
			JSON.stringify(active.config),
			() => !active.signal.aborted,
			async (text) => {
				await this.settings.rootFor(document.uri);
				const changed =
					document.version !== version ||
					document.isDirty ||
					active.signal.aborted;
				if (changed) {
					return false;
				}
				const edit = new vscode.WorkspaceEdit();
				edit.replace(
					document.uri,
					new vscode.Range(0, 0, document.lineCount, 0),
					text,
				);
				return vscode.workspace.applyEdit(edit);
			},
		);
	}

	/** 標準ダイアログでフォルダのみを選び、選択中の外部更新や境界変更を再検査する。 */
	private async pickDirectory(
		document: vscode.TextDocument,
		version: number,
		root: string,
	) {
		const selected = await vscode.window.showOpenDialog({
			title: "ディレクトリの選択",
			defaultUri: vscode.Uri.file(root),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});
		const uri = selected?.[0];
		if (uri && uri.scheme !== "file") {
			throw new Error("ローカルのディレクトリを選択してください。");
		}
		const directory = uri
			? await selectedDirectory(root, uri.fsPath)
			: null;
		await this.settings.rootFor(document.uri);
		if (version !== document.version) {
			throw new Error(
				"選択中に文書が更新されました。もう一度選択してください。",
			);
		}
		return directory;
	}

	/** 文書の版を検査し、直列化した操作の結果を通知する。 */
	private createRequestHandler(
		parsed: { data: GuardRequest },
		document: vscode.TextDocument,
		root: string,
		publish: () => void,
		post: (message: GuardReply) => void,
	) {
		return async () => {
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
				await this.handle(message, document, root, (reply) => {
					publish();
					post(reply);
				});
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
		};
	}
}

/** コマンドからルートを選び、既存ファイルを維持して専用エディターを開く。 */
export async function registerGuardrailsEditor(
	context: vscode.ExtensionContext,
) {
	const settings = new GuardrailsSettings(context.workspaceState);
	await settings.restore();
	/** 対象ルートを確認し、未作成の場合だけ既定設定を作って専用画面で開く。 */
	const openGuardrailsEditor = async () => {
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
				if (!(error instanceof vscode.FileSystemError)) {
					throw error;
				}
				if (error.code !== "FileNotFound") {
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
				const matchesValue = !(await vscode.workspace.applyEdit(edit));
				if (matchesValue) {
					throw new Error("設定ファイルを作成できませんでした。", {
						cause: error,
					});
				}
			}
			await vscode.commands.executeCommand(
				"vscode.openWith",
				uri,
				guardrailsViewType,
			);
		} catch (error) {
			void vscode.window.showErrorMessage(errorText(error));
		}
	};
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			guardrailsViewType,
			new GuardrailsEditor(context, settings),
			{ supportsMultipleEditorsPerDocument: false },
		),
		vscode.commands.registerCommand(
			"nerita.pi.guardrails",
			openGuardrailsEditor,
		),
		{ dispose: () => guardrailRegistry.dispose() },
	);
	return settings;
}
