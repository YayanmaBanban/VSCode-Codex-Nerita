// 接続前のワークスペース条件を検証し、利用者が解決できる原因を区別する。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import path from "node:path";
import { WorkspaceError } from "./workspaceError";

/** Windows の大小文字・区切り・末尾スラッシュの差を吸収する。 */
export function sameCwd(left: string, right: string): boolean {
	/** 比較用のパスを絶対化し、末尾の区切りと Windows の大文字・小文字の違いを吸収する。 */
	const normalize = (value: string) =>
		path
			.resolve(value)
			.replace(/[\\/]+$/, "")
			.toLowerCase();
	return normalize(left) === normalize(right);
}
/** VS Code に依存せず検査できるフォルダ情報。 */
type WorkspaceFolder = { uri: { scheme: string; fsPath: string } };

/** 単一の信頼済みローカルフォルダだけを Codex の作業場所にする。 */
export function requireLocalWorkspace(
	folders: readonly WorkspaceFolder[] | undefined,
	trusted: boolean,
	remoteName: string | undefined,
): string {
	if (!isNonZeroNumber(folders?.length)) {
		throw new WorkspaceError(
			"作業フォルダが開かれていません。VS Codeで「ファイル → フォルダを開く」を選択してから、再接続してください。",
		);
	}
	if (!trusted) {
		throw new WorkspaceError(
			"ワークスペースが制限モードです。フォルダの内容を確認して信頼を設定してから、再接続してください。",
		);
	}
	if (isNonEmptyString(remoteName)) {
		throw new WorkspaceError(
			"Remote・WSL・Dev Containersには未対応です。ローカルのVS Codeウィンドウでフォルダを開いてください。",
		);
	}
	if (folders.length !== 1) {
		throw new WorkspaceError(
			"現在は一つの作業フォルダに対応しています。フォルダを一つだけ開いてから、再接続してください。",
		);
	}
	const folder = folders[0];
	if (!folder || folder.uri.scheme !== "file") {
		throw new WorkspaceError(
			"仮想ワークスペースには未対応です。ローカルディスクのフォルダを開いてください。",
		);
	}
	return folder.uri.fsPath;
}
