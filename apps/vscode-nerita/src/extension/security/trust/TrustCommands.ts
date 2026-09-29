// 信頼の昇格と取消しを VS Code の明示操作へ限定し、状態をステータスバーに表示する。
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { WorkspaceTrustStore } from "./WorkspaceTrustStore";
import { canonicalPath } from "../WorkspacePathPolicy";
import { containsPath } from "../AgentAccessPolicy";
import { stat } from "node:fs/promises";
import { configuredBackend } from "../../webview/backendSettings";
import { trustPanel } from "./TrustPanel";

/** 正本は `globalState` に保存し、ワークスペース設定による信頼の注入を防ぐ。 */
export function registerTrustCommands(context: vscode.ExtensionContext) {
	const key = "nerita.workspaceTrust.v1";
	const log = vscode.window.createOutputChannel("Nerita Trust", {
		log: true,
	});
	const store = new WorkspaceTrustStore(
		{
			read: () =>
				context.globalState.get(`${key}.pending`)
					? null
					: context.globalState.get(key),
			write: async (value) => {
				await context.globalState.update(`${key}.pending`, true);
				await context.globalState.update(key, value);
				await context.globalState.update(`${key}.pending`, false);
			},
		},
		(event, root) =>
			log.info(
				`${event} root=${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
			),
	);
	const badge = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		20,
	);
	badge.command = "nerita.trust.manage";
	let revision = 0;
	const refresh = async () => {
		const current = ++revision;
		if (configuredBackend() !== "pi") {
			badge.hide();
			return;
		}
		const roots = vscode.workspace.workspaceFolders ?? [];
		const trusted = await Promise.all(
			roots.map((root) => store.trusted(root.uri.fsPath)),
		);
		if (current !== revision) {
			return;
		}
		const count = vscode.workspace.isTrusted
			? trusted.filter(Boolean).length
			: 0;
		badge.text = `$(shield) Nerita Trust ${count}/${roots.length}`;
		badge.tooltip =
			"rootごとの信頼状態を管理します。未信頼のコードは実行できません。";
		badge.show();
	};
	const openPanel = trustPanel(context, store, (root, active) =>
		confirmTrust(store, root, active),
	);
	const unsubscribe = store.onChange(() => {
		void refresh();
	});
	context.subscriptions.push(
		log,
		badge,
		{ dispose: unsubscribe },
		vscode.commands.registerCommand("nerita.trust.manage", openPanel),
		vscode.commands.registerCommand("nerita.trust.revoke", openPanel),
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

/** 確認画面に表示した実体だけを信頼し、待機中の差替えを拒否する。 */
async function confirmTrust(
	store: WorkspaceTrustStore,
	root: string,
	active: () => boolean,
) {
	if (!vscode.workspace.isTrusted) {
		await vscode.window.showWarningMessage(
			"VS CodeのWorkspace Trustも必要です。制限モードを解除してから再試行してください。",
		);
		return;
	}
	const canonical = await canonicalPath(root, process.cwd());
	const info = await stat(canonical);
	const identity = {
		dev: info.dev,
		ino: info.ino,
		birthtimeMs: info.birthtimeMs,
	};
	const external = store
		.list()
		.some(
			(record) =>
				record.origin !== "workspace" &&
				containsPath(record.root, canonical),
		);
	const answer = await vscode.window.showWarningMessage(
		`このコードを信頼しますか？\n${canonical}`,
		{
			modal: true,
			detail: `出所: ${external ? "外部取得物" : "ユーザーが選択したフォルダー"}\nPowerShell・test・build・installなどの実行が可能になります。コマンドのApprovalとSandboxは引き続き必要です。認証情報やネットワークの利用許可は増えません。`,
		},
		"Trust this root",
	);
	if (active() && answer === "Trust this root") {
		await store.setUserTrust(canonical, true, identity);
	}
}
