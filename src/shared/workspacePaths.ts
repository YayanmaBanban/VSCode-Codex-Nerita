// パス選択に必要な項目だけをHostとWebviewで共有する。
import { isSymbolLocation, type SymbolLocation } from "./symbolLocation";

/** ディレクトリの展開先と、本文に挿入するパス。 */
export type WorkspacePath = {
	uri: string;
	name: string;
	path: string;
	kind: "file" | "directory";
	symbol?: SymbolLocation;
};

/** 一階層だけを取得する要求。nullはワークスペース一覧を表す。 */
export type WorkspacePathsRequest = {
	type: "workspace/listPaths";
	requestId: string;
	uri: string | null;
};

/** 要求元のメニューだけに返す一覧または読み込みエラー。 */
export type WorkspacePathsResult = {
	type: "workspace/paths";
	requestId: string;
	entries: WorkspacePath[];
	error?: string;
};

/** URIと表示用パスの通信上限を検証する。 */
export function isPathString(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= 32_768
	);
}

/** Hostから受け取る一覧項目を検証する。 */
export function isWorkspacePath(value: unknown): value is WorkspacePath {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		isPathString(entry.uri) &&
		isPathString(entry.name) &&
		isPathString(entry.path) &&
		(entry.kind === "file" || entry.kind === "directory") &&
		(entry.symbol === undefined ||
			(entry.kind === "file" && isSymbolLocation(entry.symbol)))
	);
}
