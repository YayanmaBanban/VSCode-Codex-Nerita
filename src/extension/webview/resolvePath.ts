// 明示的に貼り付けられたパスだけを調べ、本文を読まずに参照の種類を確定する。
import * as vscode from "vscode";
import { win32 } from "node:path";
import {
	isAbsoluteLocalPath,
	type ResolvePathRequest,
	type ResolvePathResult,
} from "../../shared/workspacePaths";

/** 一覧選択と異なり、ユーザー指定のワークスペース外パスも参照にできる。 */
export async function resolvePath(
	request: ResolvePathRequest,
): Promise<ResolvePathResult> {
	const result: ResolvePathResult = {
		type: "workspace/resolvedPath",
		requestId: request.requestId,
		entry: null,
	};
	if (!isAbsoluteLocalPath(request.path) || vscode.env.remoteName) {
		return result;
	}
	try {
		const uri = vscode.Uri.file(win32.normalize(request.path));
		const stat = await vscode.workspace.fs.stat(uri);
		const kind =
			stat.type & vscode.FileType.Directory
				? "directory"
				: stat.type & vscode.FileType.File
					? "file"
					: null;
		if (kind) {
			result.entry = {
				uri: uri.toString(),
				path: uri.fsPath,
				name: win32.basename(uri.fsPath) || uri.fsPath,
				kind,
			};
		}
	} catch {
		// 未存在・アクセス不可は、貼り付け済みの本文を維持する。
	}
	return result;
}
