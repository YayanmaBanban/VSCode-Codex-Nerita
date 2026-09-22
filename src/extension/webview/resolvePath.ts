// 明示的に貼り付けられたパスだけを調べ、本文を読まずに参照の種類を確定する。
import * as vscode from "vscode";
import { win32 } from "node:path";
import { isSourceRange } from "../../shared/symbolLocation";
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
	if (
		!isAbsoluteLocalPath(request.path) ||
		vscode.env.remoteName ||
		(request.range !== undefined && !isSourceRange(request.range))
	) {
		return result;
	}
	try {
		const uri = vscode.Uri.file(win32.normalize(request.path));
		const stat = await vscode.workspace.fs.stat(uri);
		const kind = pathKind(stat.type);
		if (kind && (!request.range || kind === "file")) {
			result.entry = {
				uri: uri.toString(),
				path: uri.fsPath,
				name: win32.basename(uri.fsPath) || uri.fsPath,
				kind,
				...(request.range ? { range: request.range } : {}),
			};
		}
	} catch {
		// 未存在・アクセス不可は、貼り付け済みの本文を維持する。
	}
	return result;
}

/** ディレクトリを優先してVS Codeのファイル種別を判定する。 */
function pathKind(type: vscode.FileType): "directory" | "file" | null {
	if (type & vscode.FileType.Directory) {
		return "directory";
	}
	if (type & vscode.FileType.File) {
		return "file";
	}
	return null;
}
