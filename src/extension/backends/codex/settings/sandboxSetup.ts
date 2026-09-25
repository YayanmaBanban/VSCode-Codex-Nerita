// Windows の Pi 利用時に、明示的なコマンドから Codex Sandbox をセットアップする。
import * as vscode from "vscode";
import { z } from "zod";
import { CodexClient } from "../CodexClient";
import { resolveWindowsSandbox } from "../CodexSandboxExecutor";
import { requireLocalWorkspace } from "../../../workspace";

const completionSchema = z.object({
	mode: z.enum(["elevated", "unelevated"]),
	success: z.boolean(),
	error: z.string().nullable(),
});

/** セットアップ受付と完了を区別し、完了通知まで接続を保持する。 */
export function registerSandboxSetup(context: vscode.ExtensionContext): void {
	if (!canSetupPiSandbox()) {
		return;
	}
	const lifetime = new AbortController();
	let running = false;
	context.subscriptions.push(
		{ dispose: () => lifetime.abort() },
		vscode.commands.registerCommand(
			"nerita.pi.setupCodexWindowsSandbox",
			async () => {
				if (running || !canSetupPiSandbox()) {
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
						async () => {
							let complete!: () => void;
							let fail!: (error: Error) => void;
							const finished = new Promise<void>(
								(resolve, reject) => {
									complete = resolve;
									fail = reject;
								},
							);
							// 接続失敗や通知先行でも未処理 `reject` を作らない。
							void finished.catch(() => undefined);
							const cancel = () =>
								fail(
									new Error(
										"Sandboxセットアップの接続が終了しました。",
									),
								);
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
								180_000,
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
										notification: (message) => {
											if (
												message.method !==
												"windowsSandbox/setupCompleted"
											) {
												return;
											}
											const parsed =
												completionSchema.safeParse(
													message.params,
												);
											if (
												!parsed.success ||
												parsed.data.mode !== mode
											) {
												fail(
													new Error(
														"Sandboxセットアップの応答が不正です。",
													),
												);
												return;
											}
											if (parsed.data.success) {
												complete();
											} else {
												fail(
													new Error(
														parsed.data.error ??
															"Sandboxセットアップに失敗しました。",
													),
												);
											}
										},
									},
								});
								if (
									!(
										await client.setupWindowsSandbox(
											cwd,
											mode,
										)
									).started
								) {
									throw new Error(
										"Sandboxセットアップを開始できませんでした。",
									);
								}
								await finished;
							} finally {
								clearTimeout(timeout);
								lifetime.signal.removeEventListener(
									"abort",
									cancel,
								);
								await client?.dispose();
							}
						},
					);
					void vscode.window.showInformationMessage(
						"Windows Sandbox のセットアップが完了しました。Piへ再接続してください。",
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

/** 設定変更後の直接呼出しでも、Codex バックエンドからは開始させない。 */
function canSetupPiSandbox(): boolean {
	return (
		process.platform === "win32" &&
		vscode.workspace
			.getConfiguration("nerita")
			.get<string>("backend", "codex") === "pi"
	);
}
