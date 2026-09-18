// チップと添付一覧から、ローカルのファイル・フォルダをVS Codeで表示する。
import * as vscode from "vscode";
import { isSourceRange, type SourceRange } from "../../shared/symbolLocation";

/** 実在するローカルURIだけを開き、Webview由来のコマンドURIは実行しない。 */
export async function openResource(
	value: string,
	range?: SourceRange,
): Promise<void> {
	if (range !== undefined && !isSourceRange(range)) {
		throw new Error("Invalid source range");
	}
	const uri = vscode.Uri.parse(value, true);
	if (uri.scheme !== "file" || uri.query || uri.fragment) {
		throw new Error("Unsupported resource URI");
	}
	const stat = await vscode.workspace.fs.stat(uri);
	if ((stat.type & vscode.FileType.Directory) !== 0) {
		await vscode.commands.executeCommand("revealInExplorer", uri);
	} else if ((stat.type & vscode.FileType.File) !== 0) {
		await vscode.commands.executeCommand("vscode.open", uri, {
			viewColumn: vscode.ViewColumn.Active,
			preview: false,
			preserveFocus: false,
			...(range
				? {
						selection: new vscode.Range(
							range.start.line,
							range.start.character,
							range.end.line,
							range.end.character,
						),
					}
				: {}),
		} satisfies vscode.TextDocumentShowOptions);
	} else {
		throw new Error("Unsupported resource type");
	}
}
