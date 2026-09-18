// ワークスペースの必要な一階層だけをVS Code APIで列挙する。
import * as vscode from "vscode";
import type {
	WorkspacePath,
	WorkspacePathsRequest,
	WorkspacePathsResult,
} from "../../shared/workspacePaths";

/** URIから選択候補を作り、ローカル環境では絶対パスを挿入する。 */
function entry(
	uri: vscode.Uri,
	name: string,
	kind: WorkspacePath["kind"],
): WorkspacePath {
	return {
		uri: uri.toString(),
		name,
		path: uri.scheme === "file" ? uri.fsPath : uri.toString(),
		kind,
	};
}

/** 再帰走査せず、要求されたワークスペース内ディレクトリだけを読む。 */
export async function listWorkspacePaths(
	request: WorkspacePathsRequest,
): Promise<WorkspacePathsResult> {
	try {
		if (request.uri === null) {
			return {
				type: "workspace/paths",
				requestId: request.requestId,
				entries: (vscode.workspace.workspaceFolders ?? []).map(
					(folder) => entry(folder.uri, folder.name, "directory"),
				),
			};
		}
		const uri = vscode.Uri.parse(request.uri, true);
		if (
			uri.query ||
			uri.fragment ||
			!vscode.workspace.getWorkspaceFolder(uri)
		) {
			throw new Error("Outside workspace");
		}
		const children = await vscode.workspace.fs.readDirectory(uri);
		const entries = children
			.filter(
				([name, type]) =>
					name !== ".git" &&
					name !== "node_modules" &&
					(type &
						(vscode.FileType.File | vscode.FileType.Directory)) !==
						0,
			)
			.map(([name, type]) =>
				entry(
					vscode.Uri.joinPath(uri, name),
					name,
					(type & vscode.FileType.Directory) !== 0
						? "directory"
						: "file",
				),
			)
			.sort(
				(a, b) =>
					Number(b.kind === "directory") -
						Number(a.kind === "directory") ||
					a.name.localeCompare(b.name),
			);
		return {
			type: "workspace/paths",
			requestId: request.requestId,
			entries,
		};
	} catch {
		return {
			type: "workspace/paths",
			requestId: request.requestId,
			entries: [],
			error: "フォルダを読み込めませんでした。戻って再度開いてください。",
		};
	}
}
