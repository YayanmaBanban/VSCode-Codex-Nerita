// パス選択のストーリーで、階層・空フォルダ・読み込み失敗を再現する。
import type {
	WorkspacePath,
	WorkspacePathsRequest,
	WorkspacePathsResult,
	ResolvePathRequest,
	ResolvePathResult,
} from "../../../shared/workspacePaths";

/** ローカル Windows パスを持つ候補を作る。 */
function entry(path: string, kind: WorkspacePath["kind"]): WorkspacePath {
	return {
		uri: `file:///D:/workspace/${path}`,
		path: `D:\\workspace\\${path.replaceAll("/", "\\")}`,
		name: path.split("/").at(-1)!,
		kind,
	};
}
const project = entry("project", "directory");
const source = entry("project/src", "directory");
const empty = entry("project/empty", "directory");
const unavailable = entry("project/unavailable", "directory");
const directories: Record<string, WorkspacePath[]> = {
	[project.uri]: [
		source,
		empty,
		unavailable,
		entry("project/日本語 sample.md", "file"),
	],
	[source.uri]: [entry("project/src/ComposerInput.tsx", "file")],
	[empty.uri]: [],
};

/** 貼り付けでも一覧と同じ参照を返し、候補にないパスは null にする。 */
export function mockResolvePath(
	message: ResolvePathRequest,
): ResolvePathResult {
	const result: ResolvePathResult = {
		type: "workspace/resolvedPath",
		requestId: message.requestId,
		entry:
			[project, ...Object.values(directories).flat()].find(
				(item) =>
					item.path.toLowerCase() ===
					message.path
						.replaceAll("/", "\\")
						.replace(/[\\]+$/, "")
						.toLowerCase(),
			) ?? null,
	};
	if (result.entry && message.range) {
		result.entry =
			result.entry.kind === "file"
				? { ...result.entry, range: message.range }
				: null;
	}
	return result;
}
/** 非同期応答の内容を、実ファイルへアクセスせず生成する。 */
export function mockWorkspacePaths(
	message: WorkspacePathsRequest,
): WorkspacePathsResult {
	return {
		type: "workspace/paths",
		requestId: message.requestId,
		entries:
			message.uri === null ? [project] : (directories[message.uri] ?? []),
		...(message.uri === unavailable.uri
			? {
					error: "フォルダを読み込めませんでした。戻って再度開いてください。",
				}
			: {}),
	};
}
