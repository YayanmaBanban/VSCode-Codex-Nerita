// 認証URLと質問入力をVS Codeの標準UIへ接続し、取消でダイアログを閉じる。
import * as vscode from "vscode";
import type { AuthService } from "./AuthFlow";
import type { InteractionService } from "./interactionRequests";

/** AbortSignalをVS Codeの取消トークンへ変換する。 */
async function cancellable<T>(
	signal: AbortSignal,
	action: (token: vscode.CancellationToken) => Thenable<T>,
): Promise<T> {
	signal.throwIfAborted();
	const source = new vscode.CancellationTokenSource();
	const abort = () => source.cancel();
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await action(source.token);
	} finally {
		signal.removeEventListener("abort", abort);
		source.dispose();
	}
}
/** ブラウザ起動に失敗した場合は認証・入力側へ通知する。 */
async function open(url: string): Promise<void> {
	if (!(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
		throw new Error("Browser unavailable");
	}
}
/** APIキーは環境変数からHost内でのみ読み取る。 */
export const authService: AuthService = {
	open,
	apiKey: () => process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY,
};
/** 質問・フォームはエディターの入力UIを使い、秘密の入力をチャット履歴に残さない。 */
export const interactionService: InteractionService = {
	open,
	input: (title, password, signal, validateInput) =>
		cancellable(signal, (token) =>
			vscode.window.showInputBox(
				{
					title: "Codexからの確認",
					prompt: title,
					password,
					ignoreFocusOut: true,
					...(validateInput ? { validateInput } : {}),
				},
				token,
			),
		),
	choose: (title, choices, signal) =>
		cancellable(signal, (token) =>
			vscode.window.showQuickPick(
				choices,
				{
					title: "Codexからの確認",
					placeHolder: title,
					ignoreFocusOut: true,
				},
				token,
			),
		),
};
