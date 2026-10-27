// 未表示時と文書表示後の VS Code の候補、および製品の変換結果を同じ言語プロバイダーで比較する。
import * as vscode from "vscode";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
import { searchWorkspaceSymbols } from "../../apps/vscode-nerita/src/extension/webview/workspaceSymbols";

/** API の生結果を残し、候補の未取得と変換時の欠落を区別する。 */
export async function run() {
	const repository = process.env.NERITA_SYMBOL_REPOSITORY === "true";
	const query = repository ? "createPromptSubmitter" : "WorkspaceSymbolProbe";
	const source = vscode.Uri.joinPath(
		vscode.workspace.workspaceFolders![0]!.uri,
		repository
			? "apps/nerita-ui/src/chat/composer/usePromptSubmission.svelte.ts"
			: "example.ts",
	);
	const snapshots = [];
	for (const stage of [
		"unopened",
		"activated",
		"loaded",
		"opened",
	] as const) {
		if (stage === "activated") {
			await vscode.extensions
				.getExtension("vscode.typescript-language-features")!
				.activate();
		}
		if (stage === "loaded") {
			await vscode.workspace.openTextDocument(source);
		}
		if (stage === "opened") {
			await vscode.window.showTextDocument(source);
		}
		const raw = await vscode.commands.executeCommand(
			"vscode.executeWorkspaceSymbolProvider",
			query,
		);
		const started = Date.now();
		const result = await searchWorkspaceSymbols({
			type: "workspace/searchSymbols",
			requestId: stage,
			query,
		});
		snapshots.push({
			stage,
			raw,
			result,
			milliseconds: Date.now() - started,
			documents: vscode.workspace.textDocuments.map((document) =>
				document.uri.toString(),
			),
		});
		await setTimeout(1000);
	}
	await writeFile(
		process.env.NERITA_SYMBOL_REPORT!,
		JSON.stringify(snapshots, null, 2),
	);
	assert.ok(
		snapshots
			.find((snapshot) => snapshot.stage === "loaded")!
			.result.entries.some((entry) => entry.name.startsWith(query)),
		"言語機能が読み込んだ文書の定義を返す",
	);
}
