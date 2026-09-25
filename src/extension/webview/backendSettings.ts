// バックエンドの選択を保存し、セッションの再生成が必要かを返す。
import * as vscode from "vscode";
import type { BackendId } from "../../shared/backend";

/** 起動時と同じ `window` スコープの設定を取得する。 */
export function configuredBackend(): BackendId {
	return vscode.workspace.getConfiguration("nerita").get("backend") === "pi"
		? "pi"
		: "codex";
}

/** 既存のワークスペース指定を優先し、それ以外はユーザー設定へ保存する。 */
export async function saveBackend(backend: BackendId): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("nerita");
	if (configuredBackend() === backend) {
		return false;
	}
	const inspection = config.inspect<BackendId>("backend");
	await config.update(
		"backend",
		backend,
		inspection?.workspaceValue !== undefined
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global,
	);
	return true;
}
