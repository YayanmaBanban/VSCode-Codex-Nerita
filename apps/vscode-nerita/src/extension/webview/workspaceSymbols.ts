// VS Code の言語プロバイダーから検索し、Webview には位置情報だけを渡す。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import * as vscode from "vscode";
import { setTimeout as delay } from "node:timers/promises";
import {
	isWorkspacePath,
	type WorkspacePath,
} from "@nerita/shared/workspacePaths";
import type {
	WorkspaceSymbolsRequest,
	WorkspaceSymbolsResult,
} from "@nerita/shared/workspaceSymbols";

// 言語機能の準備中にも空の検索結果が返るため、短時間だけ再試行する。プロジェクトの探索・初期化は VS Code に任せる。
const initializationGraceMs = 2_000;
const retryIntervalMs = 200;

/** 空の検索結果は一定時間だけ再試行し、該当なしの場合も待機を終える。 */
async function workspaceSymbolMatches(query: string, signal?: AbortSignal) {
	const deadline = Date.now() + initializationGraceMs;
	for (;;) {
		signal?.throwIfAborted();
		const symbols = await vscode.commands.executeCommand<
			vscode.SymbolInformation[] | undefined
		>("vscode.executeWorkspaceSymbolProvider", query);
		signal?.throwIfAborted();
		if ((symbols?.length ?? 0) > 0 || Date.now() >= deadline) {
			return symbols;
		}
		await delay(retryIntervalMs, undefined, { signal });
	}
}

/** 空検索では全走査せず、重複を除いた最大100件のローカル定義を返す。 */
export async function searchWorkspaceSymbols(
	request: WorkspaceSymbolsRequest,
	signal: AbortSignal = new AbortController().signal,
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
		const symbols = await workspaceSymbolMatches(
			request.query.trim(),
			signal,
		);
		Object.assign(result, collectWorkspaceSymbols(symbols ?? []));
	} catch (error) {
		if (signal.aborted) {
			throw error;
		}
		result.error =
			"シンボルを検索できませんでした。検索語を変更して再試行してください。";
	}
	return result;
}

/** 位置情報を検証し、重複を取り除いた最大100件を返す。 */
function collectWorkspaceSymbols(symbols: vscode.SymbolInformation[]) {
	const result: { entries: WorkspacePath[]; truncated: boolean } = {
		entries: [],
		truncated: false,
	};
	const seen = new Set<string>();
	for (const symbol of symbols) {
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
	return result;
}

/** 検索対象のワークスペースに属するローカル位置だけを受け付ける。 */
function unsupportedSymbolLocation(location: vscode.Location | undefined) {
	const range: unknown = location?.range;
	const invalidLocation =
		!location || !Boolean(range) || location.uri.scheme !== "file";

	if (invalidLocation) {
		return true;
	}
	if (isNonEmptyString(location.uri.query)) {
		return true;
	}
	if (isNonEmptyString(location.uri.fragment)) {
		return true;
	}
	return !vscode.workspace.getWorkspaceFolder(location.uri);
}
