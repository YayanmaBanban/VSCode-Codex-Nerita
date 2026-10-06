// VS Code のコマンドから Codex バックエンドの Windows Sandbox をセットアップする。

import type { AppServerNotification } from "../protocol/rpcMessage";

import * as vscode from "vscode";
import { z } from "zod";
import { CodexClient } from "../CodexClient";
import { requireLocalWorkspace } from "../../../workspace";
import type { WindowsSandboxSetupMode } from "../codex-app-server/v2/WindowsSandboxSetupMode";

const completionSchema = z.object({
	mode: z.enum(["elevated", "unelevated"]),
	success: z.boolean(),
	error: z.string().nullable(),
});

/** セットアップ受付と完了を区別し、完了通知まで接続を保持する。 */
export function registerSandboxSetup(context: vscode.ExtensionContext): void {
	if (process.platform !== "win32") {
		return;
	}
	const lifetime = new AbortController();
	let running = false;
	context.subscriptions.push(
		{ dispose: () => lifetime.abort() },
		vscode.commands.registerCommand(
			"nerita.codex.setupWindowsSandbox",
			async () => {
				if (running || !canSetupCodexSandbox()) {
					return;
				}
				running = true;
				try {
					const cwd = requireLocalWorkspace(
						vscode.workspace.workspaceFolders,
						vscode.workspace.isTrusted,
						vscode.env.remoteName,
					);
					const mode = await resolveWindowsSandbox(
						context.extensionUri.fsPath,
						cwd,
						lifetime.signal,
					);
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Windows Sandbox (${mode}) セットアップ`,
						},
						createSandboxSetupTask(lifetime, context, cwd, mode),
					);
					void vscode.window.showInformationMessage(
						"Windows Sandbox のセットアップが完了しました。Codexへ再接続してください。",
					);
				} catch (error) {
					void vscode.window.showErrorMessage(
						error instanceof Error ? error.message : String(error),
					);
				} finally {
					running = false;
				}
			},
		),
	);
}

/** 完了通知・接続終了・中断を待ち、終了時にタイマーを取り消して接続を閉じる。 */
function createSandboxSetupTask(
	lifetime: AbortController,
	context: vscode.ExtensionContext,
	cwd: string,
	mode: WindowsSandboxSetupMode,
): (
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	token: vscode.CancellationToken,
) => Thenable<void> {
	return async () => {
		let complete!: () => void;
		let fail!: (error: Error) => void;
		const finished = new Promise<void>((resolve, reject) => {
			complete = resolve;
			fail = reject;
		});
		// 完了待ちを始める前に接続失敗や通知が届いても、Promise の拒否を未処理にしない。
		void finished.catch(() => undefined);
		const cancel = () =>
			fail(new Error("Sandboxセットアップの接続が終了しました。"));
		lifetime.signal.addEventListener("abort", cancel, {
			once: true,
		});
		const timeout = setTimeout(
			() =>
				fail(
					new Error(
						"セットアップ完了を確認できませんでした。状態を再確認してください。",
					),
				),
			180000,
		);
		let client: CodexClient | undefined;
		try {
			client = await CodexClient.connect({
				extensionPath: context.extensionUri.fsPath,
				cwd,
				signal: lifetime.signal,
				windowsSandbox: mode,
				clientInfo: {
					name: "nerita_sandbox_setup",
					title: "Nerita Sandbox Setup",
					version: "0.0.1",
				},
				callbacks: {
					disconnected: fail,
					notification: createSandboxCompletionHandler(
						mode,
						fail,
						complete,
					),
				},
			});
			if (!(await client.setupWindowsSandbox(cwd, mode)).started) {
				throw new Error("Sandboxセットアップを開始できませんでした。");
			}
			await finished;
		} finally {
			clearTimeout(timeout);
			lifetime.signal.removeEventListener("abort", cancel);
			await client?.dispose();
		}
	};
}

/** 完了通知の種類と実行モードを検証してから待機を解く。 */
function createSandboxCompletionHandler(
	mode: string,
	fail: (error: Error) => void,
	complete: () => void,
): (message: AppServerNotification) => void {
	return (message) => {
		if (message.method !== "windowsSandbox/setupCompleted") {
			return;
		}
		const parsed = completionSchema.safeParse(message.params);
		if (!parsed.success || parsed.data.mode !== mode) {
			fail(new Error("Sandboxセットアップの応答が不正です。"));
			return;
		}
		if (parsed.data.success) {
			complete();
		} else {
			fail(
				new Error(
					parsed.data.error ?? "Sandboxセットアップに失敗しました。",
				),
			);
		}
	};
}

/** Pi へ切り替えた後は、コマンドを直接呼び出しても App Server を起動しない。 */
function canSetupCodexSandbox(): boolean {
	return (
		process.platform === "win32" &&
		vscode.workspace
			.getConfiguration("nerita")
			.get<string>("backend", "codex") === "codex"
	);
}

/** Codex の既存設定を読み、Windows Sandbox のモードが未指定の場合だけ `elevated` を使う。 */
async function resolveWindowsSandbox(
	extensionPath: string,
	cwd: string,
	signal: AbortSignal,
): Promise<WindowsSandboxSetupMode> {
	const client = await CodexClient.connect({
		extensionPath,
		cwd,
		signal,
		clientInfo: {
			name: "nerita_codex_sandbox_config",
			title: "Nerita Codex Sandbox",
			version: "0.0.1",
		},
	});
	try {
		const { sandbox } = await client.readSandboxConfig(cwd);
		if (sandbox === null) {
			return "elevated";
		}
		if (sandbox === "elevated" || sandbox === "unelevated") {
			return sandbox;
		}
		throw new Error(`Windows Sandboxの設定に対応していません: ${sandbox}`);
	} finally {
		await client.dispose();
	}
}
