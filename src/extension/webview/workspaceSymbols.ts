// VS Codeの言語プロバイダーから検索し、Webviewには位置情報だけを渡す。
import * as vscode from "vscode";
import {
	isWorkspacePath,
	type WorkspacePath,
} from "../../shared/workspacePaths";
import type {
	WorkspaceSymbolsRequest,
	WorkspaceSymbolsResult,
} from "../../shared/workspaceSymbols";

/** 空検索では全走査せず、重複を除いた最大100件のローカル定義を返す。 */
export async function searchWorkspaceSymbols(
	request: WorkspaceSymbolsRequest,
): Promise<WorkspaceSymbolsResult> {
	const result: WorkspaceSymbolsResult = {
		type: "workspace/symbols",
		requestId: request.requestId,
		entries: [],
		truncated: false,
	};
	if (!request.query.trim()) {
		return result;
	}
	try {
		const symbols = await vscode.commands.executeCommand<
			vscode.SymbolInformation[]
		>("vscode.executeWorkspaceSymbolProvider", request.query.trim());
		const seen = new Set<string>();
		for (const symbol of symbols ?? []) {
			const location = symbol.location;
			if (
				!location?.range ||
				location.uri.scheme !== "file" ||
				location.uri.query ||
				location.uri.fragment ||
				!vscode.workspace.getWorkspaceFolder(location.uri)
			) {
				continue;
			}
			const { start, end } = location.range;
			const entry: WorkspacePath = {
				uri: location.uri.toString(),
				path: location.uri.fsPath,
				name: symbol.name,
				kind: "file",
				symbol: {
					kind: symbol.kind,
					range: {
						start: { line: start.line, character: start.character },
						end: { line: end.line, character: end.character },
					},
				},
			};
			if (!isWorkspacePath(entry)) {
				continue;
			}
			const key = JSON.stringify(entry);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			if (result.entries.length === 100) {
				result.truncated = true;
				break;
			}
			result.entries.push(entry);
		}
	} catch {
		result.error =
			"シンボルを検索できませんでした。検索語を変更して再試行してください。";
	}
	return result;
}
