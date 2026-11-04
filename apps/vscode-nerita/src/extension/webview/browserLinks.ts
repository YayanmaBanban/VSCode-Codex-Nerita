// Markdown の修飾クリックと標準コンテキストメニューを、既定ブラウザーへ接続する。
import * as vscode from "vscode";
import { isBrowserUrl } from "@nerita/shared/browserLinks";
import { isRecord } from "@nerita/shared/validation";

/** Webview の要求とメニュー引数を再検証し、HTTP/HTTPS だけを OS の既定ブラウザーで開く。 */
export async function openBrowserLink(value: unknown): Promise<void> {
	if (!isBrowserUrl(value)) {
		throw new Error("Unsupported browser URL");
	}
	const opened = await vscode.env.openExternal(vscode.Uri.parse(value, true));
	if (!opened) {
		throw new Error("外部ブラウザーでリンクを開けませんでした。");
	}
}

/** VS Code のメニューから渡されるリンク先を検証し、失敗は通知する。 */
export function registerBrowserLinkCommand(
	context: Pick<vscode.ExtensionContext, "subscriptions">,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"nerita.links.openExternal",
			openFromContext,
		),
	);
}

/** メニュー条件を実行権限として信用せず、渡された URL を開く直前に検証する。 */
async function openFromContext(context: unknown): Promise<void> {
	try {
		await openBrowserLink(
			isRecord(context) ? context.neritaLinkUrl : undefined,
		);
	} catch {
		await vscode.window.showErrorMessage(
			"外部ブラウザーでリンクを開けませんでした。",
		);
	}
}
