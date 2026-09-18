// ワークスペースのシンボル検索要求と候補を共有する。
import type { WorkspacePath } from "./workspacePaths";
/** 言語プロバイダーへ渡す検索語。 */
export type WorkspaceSymbolsRequest = {
	type: "workspace/searchSymbols";
	requestId: string;
	query: string;
};
/** 候補は既存の参照チップとして挿入できる。 */
export type WorkspaceSymbolsResult = {
	type: "workspace/symbols";
	requestId: string;
	entries: WorkspacePath[];
	error?: string;
	truncated: boolean;
};
/** 検索語の通信上限を検証する。 */
export function isSymbolQuery(value: unknown): value is string {
	return typeof value === "string" && value.length <= 256;
}
/** VS CodeのSymbolKindを候補の表示名へ変換する。 */
export function symbolKindName(kind: number): string {
	return (
		[
			"File",
			"Module",
			"Namespace",
			"Package",
			"Class",
			"Method",
			"Property",
			"Field",
			"Constructor",
			"Enum",
			"Interface",
			"Function",
			"Variable",
			"Constant",
			"String",
			"Number",
			"Boolean",
			"Array",
			"Object",
			"Key",
			"Null",
			"EnumMember",
			"Struct",
			"Event",
			"Operator",
			"TypeParameter",
		][kind] ?? "Symbol"
	);
}
