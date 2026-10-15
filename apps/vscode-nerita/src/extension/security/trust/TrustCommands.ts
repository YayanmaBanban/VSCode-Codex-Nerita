// 信頼の昇格と取消しを VS Code の明示操作へ限定し、状態をステータスバーに表示する。
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { WorkspaceTrustStore } from "./WorkspaceTrustStore";
import { configuredBackend } from "../../webview/backendSettings";
import { trustPanel } from "./TrustPanel";
import { CodexWorkspaceTrust } from "../../backends/codex/settings/CodexWorkspaceTrust";

/** 信頼記録は `globalState` に保存し、ワークスペース設定で信頼済みと指定させない。 */
export function registerTrustCommands(context: vscode.ExtensionContext) {
	const key = "nerita.workspaceTrust.v1";
	const log = vscode.window.createOutputChannel("Nerita Trust", {
		log: true,
	});
	/** 保存中の印を先に残し、信頼記録の保存成功後だけその印を解除する。 */
	const persistTrustRecords = async (value: unknown) => {
		await context.globalState.update(`${key}.pending`, true);
		await context.globalState.update(key, value);
		await context.globalState.update(`${key}.pending`, false);
	};
	const store = new WorkspaceTrustStore(
		{
			read: () =>
				context.globalState.get<boolean>(`${key}.pending`) === true
					? null
					: context.globalState.get(key),
			write: persistTrustRecords,
		},
		(event, root) =>
			log.info(
				`${event} root=${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
			),
		new CodexWorkspaceTrust(context.extensionUri.fsPath, (root) =>
			store.invalidate(root, "codex"),
		),
	);
	const badge = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		20,
	);
	badge.command = "nerita.trust.manage";
	let revision = 0;
	/** 選択中バックエンドの信頼状態を表示し、古い非同期取得を破棄する。 */
	const refresh = async () => {
		const current = ++revision;
		const backend = configuredBackend();
		const roots = vscode.workspace.workspaceFolders ?? [];
		const trusted = await Promise.all(
			roots.map((root) => store.trusted(root.uri.fsPath, backend)),
		);
		if (current !== revision) {
			return;
		}
		const count = vscode.workspace.isTrusted
			? trusted.filter(Boolean).length
			: 0;
		badge.text = `$(shield) ${backend === "codex" ? "Codex" : "Nerita"} Trust ${count}/${roots.length}`;
		badge.tooltip =
			"rootごとの信頼状態を管理します。未信頼のコードは実行できません。";
		badge.show();
	};
	const openPanel = trustPanel(context, store);
	const unsubscribe = store.onChange(() => {
		void refresh();
	});
	context.subscriptions.push(
		log,
		badge,
		{ dispose: unsubscribe },
		vscode.commands.registerCommand("nerita.trust.manage", openPanel),
		vscode.workspace.onDidGrantWorkspaceTrust(() => store.invalidate()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => store.invalidate()),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("nerita.backend")) {
				void refresh();
			}
		}),
	);
	void refresh();
	return store;
}
