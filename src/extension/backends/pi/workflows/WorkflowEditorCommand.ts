// 新規定義を作る際も既存ファイルを上書きせず、専用エディタへ開く。
import * as vscode from "vscode";
import { stringify } from "smol-toml";
import { workflowFileSchema } from "../../../../shared/workflows/messages";
import { workflowDocument } from "./WorkflowDocument";

/** 保存先をワークスペースとファイル名から組み立てる。 */
export function registerWorkflowCommand(
	context: vscode.ExtensionContext,
	viewType: string,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand("nerita.pi.workflow", async () => {
			try {
				const folders = vscode.workspace.workspaceFolders ?? [];
				const folder =
					folders.length === 1
						? folders[0]
						: await vscode.window.showWorkspaceFolderPick();
				if (!folder) {
					return;
				}
				const file = await vscode.window.showInputBox({
					prompt: "Workflow のファイル名",
					value: "workflow.toml",
					validateInput: (value) =>
						workflowFileSchema.safeParse(value).success
							? null
							: "英数字から始まる .toml ファイル名を指定してください。",
				});
				if (!file) {
					return;
				}
				const uri = vscode.Uri.joinPath(
					folder.uri,
					".pi/workflows",
					file,
				);
				await workflowDocument(uri);
				const document = await createDocument(uri);
				await vscode.commands.executeCommand(
					"vscode.openWith",
					document.uri,
					viewType,
				);
			} catch (error) {
				void vscode.window.showErrorMessage(String(error));
			}
		}),
	);
}

/** 存在する定義は保持し、不在の場合だけ最小の定義を生成する。 */
async function createDocument(uri: vscode.Uri) {
	try {
		return await vscode.workspace.openTextDocument(uri);
	} catch {
		const text = stringify({
			version: 1,
			name: "workflow",
			outputs: ["start"],
			limits: { max_concurrency: 3, timeout_ms: 600000 },
			steps: [
				{
					id: "start",
					agent: "worker",
					task: "実行するタスクを入力してください",
					depends_on: [],
				},
			],
		});
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(uri, { overwrite: false, contents: Buffer.from(text) });
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error("Workflow を作成できませんでした。");
		}
		return vscode.workspace.openTextDocument(uri);
	}
}
