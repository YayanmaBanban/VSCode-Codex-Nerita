// 共通Sandbox設定をVS Codeの設定ファイルへ保存する。
import * as vscode from "vscode";
import {
	isWindowsSandboxImplementation,
	type WindowsSandboxImplementation,
} from "../../shared/windowsSandbox";

/** windowスコープの保存値を読み、不正な値は既定値へ戻す。 */
export function configuredSandbox(): WindowsSandboxImplementation {
	const value = vscode.workspace
		.getConfiguration("nerita")
		.get("windowsSandbox");
	return isWindowsSandboxImplementation(value) ? value : "elevated";
}

/** 既存のworkspace設定があれば同じ保存先を使用する。 */
export async function saveSandbox(
	value: WindowsSandboxImplementation,
): Promise<boolean> {
	if (configuredSandbox() === value) {
		return false;
	}
	const config = vscode.workspace.getConfiguration("nerita");
	await config.update(
		"windowsSandbox",
		value,
		config.inspect("windowsSandbox")?.workspaceValue !== undefined
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global,
	);
	return true;
}
