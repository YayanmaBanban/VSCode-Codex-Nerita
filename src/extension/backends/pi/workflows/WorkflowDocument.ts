// エディタの対象をワークスペース直下の Workflow 定義に限定する。
import * as vscode from "vscode";
import { basename, dirname, join, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalPath } from "../../../security/WorkspacePathPolicy";
import { containsPath } from "../../../security/AgentAccessPolicy";
import { workflowFileSchema } from "../../../../shared/workflows/messages";

/** リンク先もルートと定義ディレクトリの内側に収まることを確認する。 */
export async function workflowDocument(uri: vscode.Uri) {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!vscode.workspace.isTrusted || uri.scheme !== "file" || !folder) {
		throw new Error("信頼済みワークスペースの Workflow を開いてください。");
	}
	const file = workflowFileSchema.parse(basename(uri.fsPath));
	if (
		relative(folder.uri.fsPath, dirname(uri.fsPath)) !==
		join(".pi", "workflows")
	) {
		throw new Error(".pi/workflows 直下の TOML だけを編集できます。");
	}
	const root = await realpath(folder.uri.fsPath);
	const directory = await canonicalPath(".pi/workflows", root);
	const path = await canonicalPath(uri.fsPath, root);
	if (!containsPath(root, directory) || dirname(path) !== directory) {
		throw new Error("Workflow のリンク先が対象範囲外です。");
	}
	return { root, file };
}
