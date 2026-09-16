// VS Code のファイル選択とエディターで開く操作を提供する。
import * as vscode from "vscode";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { CodexFiles } from "../codex/CodexAttachments";

/** 選択されたローカルファイルをHost内で検証するための参照として扱う。 */
export const attachmentService: CodexFiles = {
	async pick() {
		const uris = await vscode.window.showOpenDialog({
			canSelectMany: true,
			canSelectFiles: true,
			canSelectFolders: false,
			openLabel: "添付",
			title: "Codex に添付するファイル",
		});
		return (uris ?? [])
			.filter((uri) => uri.scheme === "file")
			.map((uri) => ({
				id: randomUUID(),
				name: basename(uri.fsPath),
				uri: uri.toString(),
			}));
	},
	async open(file) {
		await vscode.commands.executeCommand(
			"vscode.open",
			vscode.Uri.parse(file.uri),
		);
	},
};
