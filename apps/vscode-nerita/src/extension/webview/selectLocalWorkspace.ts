// 管理パネルの保存先フォルダーを選び、実際のパスを取得する。
import * as vscode from "vscode";
import { realpath } from "node:fs/promises";

/** フォルダーが1つならそのまま選び、それ以外は選択を求める。選択の取り消しや仮想フォルダーでは値を返さない。 */
export async function selectLocalWorkspace() {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const folder =
		folders.length === 1
			? folders[0]
			: await vscode.window.showWorkspaceFolderPick();
	if (!folder || folder.uri.scheme !== "file") {
		return undefined;
	}
	return { folder, root: await realpath(folder.uri.fsPath) };
}
