// VS Code の言語プロバイダーから検索し、Webview には位置情報だけを渡す。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import * as vscode from "vscode";
import {
	isWorkspacePath,
	type WorkspacePath,
} from "@nerita/shared/workspacePaths";
import type {
	WorkspaceSymbolsRequest,
	WorkspaceSymbolsResult,
} from "@nerita/shared/workspaceSymbols";

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
	if (request.query.trim() === "") {
		return result;
	}
	try {
		const symbols = await vscode.commands.executeCommand<
			vscode.SymbolInformation[] | undefined
		>("vscode.executeWorkspaceSymbolProvider", request.query.trim());
		const seen = new Set<string>();
		for (const symbol of symbols ?? []) {
			const location = symbol.location;
			if (unsupportedSymbolLocation(location)) {
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

/** 検索対象のワークスペースに属するローカル位置だけを受け付ける。 */
function unsupportedSymbolLocation(location: vscode.Location | undefined) {
	const range: unknown = location?.range;
	return (
		!location ||
		!(Boolean(range) === true) ||
		location.uri.scheme !== "file" ||
		isNonEmptyString(location.uri.query) ||
		isNonEmptyString(location.uri.fragment) ||
		!vscode.workspace.getWorkspaceFolder(location.uri)
	);
}
