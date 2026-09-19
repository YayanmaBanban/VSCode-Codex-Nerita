// チップから差分をプレビューし、取得中に切り替わった会話には表示しない。
import * as vscode from "vscode";
import type { ChangeScope } from "../../../shared/changeReferences";
import { readChangeContext } from "./changeContext";

/** 送信と同じ内容を未保存の読み取り用資料として開く。 */
export async function openChanges(
	cwd: string,
	scope: ChangeScope,
	current: () => boolean,
): Promise<void> {
	const content = await readChangeContext(cwd, scope);
	if (!current()) {
		return;
	}
	const document = await vscode.workspace.openTextDocument({
		language: "diff",
		content,
	});
	if (current()) {
		await vscode.window.showTextDocument(document, {
			preview: true,
			preserveFocus: true,
		});
	}
}
