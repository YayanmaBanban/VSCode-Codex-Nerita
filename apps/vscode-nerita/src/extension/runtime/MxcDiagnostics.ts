// 会話を起動せず、実際の Extension Host から MXC の能力と起動結果を確認する。
import { errorText } from "@nerita/shared/errorText";
import * as vscode from "vscode";
import { requireLocalWorkspace } from "../workspace";
import { probeMxc } from "./MxcAvailability";
import { dockerAvailability, type SandboxAvailability } from "./SandboxBackend";

/** 固定の起動検査のみを実行する。ワークスペース内のスクリプトや設定を読み込まない。 */
export function registerMxcDiagnostics(context: vscode.ExtensionContext): void {
	const lifetime = new AbortController();
	const output = vscode.window.createOutputChannel("Nerita Sandbox");
	let running = false;
	context.subscriptions.push(
		output,
		{ dispose: () => lifetime.abort() },
		vscode.commands.registerCommand(
			"nerita.pi.checkMxcSandbox",
			async () => {
				if (running) {
					return;
				}
				running = true;
				try {
					const cwd = requireLocalWorkspace(
						vscode.workspace.workspaceFolders,
						vscode.workspace.isTrusted,
						vscode.env.remoteName,
					);
					return await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: "Microsoft MXC の起動を確認",
							cancellable: true,
						},
						(_progress, token) =>
							showDiagnostics(
								context.extensionUri.fsPath,
								cwd,
								lifetime.signal,
								output,
								token,
							),
					);
				} catch (error) {
					void vscode.window.showErrorMessage(
						error instanceof Error
							? error.message
							: errorText(error),
					);
					return undefined;
				} finally {
					running = false;
				}
			},
		),
	);
}

/** キャンセルと Extension の終了を結合し、診断のプロセスを残さない。 */
async function showDiagnostics(
	extensionPath: string,
	cwd: string,
	lifetime: AbortSignal,
	output: vscode.OutputChannel,
	token: vscode.CancellationToken,
): Promise<SandboxAvailability> {
	const controller = new AbortController();
	const subscription = token.onCancellationRequested(() =>
		controller.abort(),
	);
	try {
		const status = await probeMxc(
			extensionPath,
			cwd,
			AbortSignal.any([lifetime, controller.signal]),
		);
		output.clear();
		output.appendLine(
			JSON.stringify(
				{
					node: process.versions.node,
					backends: [status, dockerAvailability],
				},
				null,
				2,
			),
		);
		output.show(true);
		return status;
	} finally {
		subscription.dispose();
	}
}
