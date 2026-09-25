// 接続前のワークスペース条件を検証し、利用者が解決できる原因を区別する。
import path from "node:path";

/** Windows の大小文字・区切り・末尾スラッシュの差を吸収する。 */
export function sameCwd(left: string, right: string): boolean {
	const normalize = (value: string) =>
		path
			.resolve(value)
			.replace(/[\\/]+$/, "")
			.toLowerCase();
	return normalize(left) === normalize(right);
}
/** VS Code に依存せず検査できるフォルダー情報。 */
type WorkspaceFolder = { uri: { scheme: string; fsPath: string } };
/** Host で確定した、秘密情報を含まない起動条件のエラー。 */
export class WorkspaceError extends Error {}

/** 単一の信頼済みローカルフォルダーだけを Codex の作業場所にする。 */
export function requireLocalWorkspace(
	folders: readonly WorkspaceFolder[] | undefined,
	trusted: boolean,
	remoteName: string | undefined,
): string {
	if (!folders?.length) {
		throw new WorkspaceError(
			"作業フォルダーが開かれていません。VS Codeで「ファイル → フォルダーを開く」を選択してから、再接続してください。",
		);
	}
	if (!trusted) {
		throw new WorkspaceError(
			"ワークスペースが制限モードです。フォルダーの内容を確認して信頼を設定してから、再接続してください。",
		);
	}
	if (remoteName) {
		throw new WorkspaceError(
			"Remote・WSL・Dev Containersには未対応です。ローカルのVS Codeウィンドウでフォルダーを開いてください。",
		);
	}
	if (folders.length !== 1) {
		throw new WorkspaceError(
			"現在は一つの作業フォルダーに対応しています。フォルダーを一つだけ開いてから、再接続してください。",
		);
	}
	const folder = folders[0];
	if (!folder || folder.uri.scheme !== "file") {
		throw new WorkspaceError(
			"仮想ワークスペースには未対応です。ローカルディスクのフォルダーを開いてください。",
		);
	}
	return folder.uri.fsPath;
}
