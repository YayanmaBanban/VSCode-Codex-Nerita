// チップと添付一覧から、ローカルのファイル・フォルダを VS Code で表示する。
import * as vscode from "vscode";
import { isSourceRange, type SourceRange } from "../../shared/symbolLocation";

/** 実在するローカル URI だけを開き、Webview 由来のコマンド URI は実行しない。 */
export async function openResource(
	value: string,
	range?: SourceRange,
): Promise<void> {
	validateResourceRange(range);
	let uri = vscode.Uri.parse(value, true);
	if (uri.scheme !== "file" || uri.query || uri.fragment) {
		throw new Error("Unsupported resource URI");
	}
	const location = /:(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(uri.path);
	if (location) {
		const selection = resourceSelection(location);
		uri = uri.with({ path: uri.path.slice(0, location.index) });
		range ??= selection;
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

/** 表示先に渡す選択範囲を検証する。 */
function validateResourceRange(range: SourceRange | undefined) {
	if (range !== undefined && !isSourceRange(range)) {
		throw new Error("Invalid source range");
	}
}

/** URI 末尾の行・列指定を選択範囲へ変換する。 */
function resourceSelection(location: RegExpExecArray) {
	const start = {
		line: Number(location[1]) - 1,
		character: Number(location[2] ?? 1) - 1,
	};
	const selection = {
		start,
		end: location[3]
			? {
					line: Number(location[3]) - 1,
					character: Number(location[4] ?? 1) - 1,
				}
			: start,
	};
	if (!isSourceRange(selection)) {
		throw new Error("Invalid source range");
	}
	return selection;
}
