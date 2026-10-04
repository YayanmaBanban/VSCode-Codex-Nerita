// インデックスの本文を読み取り専用 URI に保持し、現在のファイルと VS Code で比較する。
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
const scheme = "nerita-diff";

/** 変更前の本文と削除済みファイル用の空の本文を保持し、ドキュメントを閉じたときに解放する。 */
export class WorkingTreeDiff implements vscode.Disposable {
	private contents = new Map<string, string>();
	private registrations: vscode.Disposable[];

	/** 仮想ドキュメントの本文を読み取り専用で提供する。 */
	constructor() {
		this.registrations = [
			vscode.workspace.registerTextDocumentContentProvider(scheme, {
				provideTextDocumentContent: (uri) => {
					const text = this.contents.get(uri.toString());
					if (text === undefined) {
						throw new Error("Unknown diff document");
					}
					return text;
				},
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				if (document.uri.scheme === scheme) {
					this.contents.delete(document.uri.toString());
				}
			}),
		];
	}

	/** `--textconv` を含む Git 処理は信頼済みワークスペース内だけで実行する。 */
	async open(path: string, cwd?: string | null): Promise<void> {
		const { workspaceFileUri, folder } = await resolveDiffFile(path, cwd);

		const root = (
			await git(folder.uri.fsPath, ["rev-parse", "--show-toplevel"])
		).trim();
		const gitPath = relative(root, workspaceFileUri.fsPath).replaceAll(
			"\\",
			"/",
		);
		if (outsideRoot(gitPath)) {
			throw new Error("File outside repository");
		}
		// 未追跡ファイルだけは空の変更前として扱い、競合・Git 失敗は隠さない。
		const tracked = await git(root, [
			"--literal-pathspecs",
			"ls-files",
			"--stage",
			"--",
			gitPath,
		]);
		const before = tracked
			? await git(root, ["show", "--textconv", `:${gitPath}`])
			: "";
		const beforeUri = vscode.Uri.from({
			scheme,
			path: workspaceFileUri.path,
			query: randomUUID(),
		});
		this.contents.set(beforeUri.toString(), before);
		let afterUri = workspaceFileUri;
		try {
			afterUri = await this.currentUri(workspaceFileUri);
			await vscode.commands.executeCommand(
				"vscode.diff",
				beforeUri,
				afterUri,
				`${basename(workspaceFileUri.fsPath)} (作業ツリー)`,
			);
		} catch (error) {
			this.contents.delete(beforeUri.toString());
			if (afterUri.scheme === scheme) {
				this.contents.delete(afterUri.toString());
			}
			throw error;
		}
	}

	/** 削除されたファイルの現在内容は空とし、存在するファイルは編集可能な URI を維持する。 */
	private async currentUri(uri: vscode.Uri): Promise<vscode.Uri> {
		try {
			await stat(uri.fsPath);
			return uri;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			const emptyUri = uri.with({ scheme, query: randomUUID() });
			this.contents.set(emptyUri.toString(), "");
			return emptyUri;
		}
	}

	/** このサービスの破棄時に、登録と残っている本文をまとめて解放する。 */
	dispose(): void {
		for (const registration of this.registrations) {
			registration.dispose();
		}
		this.contents.clear();
	}
}

/** ローカルの信頼済みワークスペースに属するファイルパスを確定する。 */
async function resolveDiffFile(path: string, cwd?: string | null) {
	if (!vscode.workspace.isTrusted || vscode.env.remoteName) {
		throw new Error("Unsupported diff workspace");
	}
	const base = cwd;
	if (!isAbsolute(path) && !base) {
		throw new Error("Missing workspace path");
	}
	const workspaceFileUri = vscode.Uri.file(
		isAbsolute(path) ? resolve(path) : resolve(base!, path),
	);
	const folder = vscode.workspace.getWorkspaceFolder(workspaceFileUri);
	if (!folder || folder.uri.scheme !== "file") {
		throw new Error("File outside workspace");
	}
	await validateRealPath(folder.uri.fsPath, workspaceFileUri.fsPath);
	return { workspaceFileUri, folder };
}

/** シェルを介さず Git を実行し、実行時間と出力量を制限する。 */
async function git(cwd: string, args: string[]) {
	const { stdout } = await exec("git", args, {
		cwd,
		encoding: "utf8",
		windowsHide: true,
		timeout: 15_000,
		maxBuffer: 8 * 1024 * 1024,
	});
	return stdout;
}

/** 削除済みファイルは親フォルダーの実体を確認し、リンク先がワークスペース外にある場合も拒否する。 */
async function validateRealPath(root: string, path: string) {
	const actualRoot = await realpath(root);
	let actualPath: string;
	try {
		actualPath = await realpath(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		actualPath = resolve(await realpath(dirname(path)), basename(path));
	}
	if (outsideRoot(relative(actualRoot, actualPath))) {
		throw new Error("File outside workspace");
	}
}

/** 同名の兄弟フォルダーもワークスペース内と誤認しない。 */
function outsideRoot(path: string) {
	return (
		path === ".." ||
		path.startsWith("../") ||
		path.startsWith("..\\") ||
		isAbsolute(path)
	);
}
