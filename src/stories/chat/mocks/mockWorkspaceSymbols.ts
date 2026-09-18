// シンボル検索の候補と空結果・失敗を実ファイルなしで再現する。
import type { WorkspacePath } from "../../../shared/workspacePaths";
import type {
	WorkspaceSymbolsRequest,
	WorkspaceSymbolsResult,
} from "../../../shared/workspaceSymbols";
/** 同名の定義を別ファイルに用意し、表示と選択位置を区別する。 */
export function mockWorkspaceSymbols(
	request: WorkspaceSymbolsRequest,
): WorkspaceSymbolsResult {
	const entries: WorkspacePath[] = [
		"services/UserService.ts",
		"tests/UserService.ts",
	].map((file, index) => ({
		uri: `file:///D:/workspace/project/src/${file}`,
		path: `D:\\workspace\\project\\src\\${file.replaceAll("/", "\\")}`,
		name: "UserService",
		kind: "file",
		symbol: {
			kind: 4,
			range: {
				start: { line: index ? 8 : 41, character: 0 },
				end: { line: index ? 20 : 137, character: 1 },
			},
		},
	}));
	return {
		type: "workspace/symbols",
		requestId: request.requestId,
		truncated: false,
		entries: entries.filter((entry) =>
			entry.name.toLowerCase().includes(request.query.toLowerCase()),
		),
		...(request.query === "error"
			? {
					error: "シンボルを検索できませんでした。検索語を変更して再試行してください。",
				}
			: {}),
	};
}
