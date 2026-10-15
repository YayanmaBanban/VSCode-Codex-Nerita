// 適用済み設定を `workspaceState` に保存し、ディスク上の編集を自動適用しない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import { guardrailRegistry } from "../../../security/GuardrailRegistry";
import { canonicalPath } from "../../../security/WorkspacePathPolicy";

/** 設定を適用できるワークスペースとファイルを Host 側で確定する。 */
export class GuardrailsSettings {
	private queue: Promise<unknown> = Promise.resolve();
	/** 設定は注入した永続状態へ保存し、別の保存先を暗黙に作らない。 */
	constructor(private readonly state: vscode.Memento) {}
	/** ディスクの `guardrails.json` ではなく、利用者が適用した内容だけを復元する。 */
	async restore() {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			if (folder.uri.scheme !== "file") {
				continue;
			}
			const root = await realpath(folder.uri.fsPath);
			const text = this.state.get<string>(`guardrails.v1:${root}`);
			try {
				guardrailRegistry.apply(
					root,
					isNonEmptyString(text)
						? parseGuardrails(text)
						: defaultGuardrails(),
				);
			} catch {
				guardrailRegistry.block(root);
				void vscode.window.showErrorMessage(
					"適用済みガードレールを復元できません。ガードレールエディターから再適用してください。",
				);
			}
		}
	}
	/** 設定ファイルへのリンクを通してワークスペース外へ保存しない。 */
	async rootFor(uri: vscode.Uri): Promise<string> {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		const matchesFolder =
			!folder ||
			uri.scheme !== "file" ||
			uri.toString() !==
				vscode.Uri.joinPath(
					folder.uri,
					".pi",
					"guardrails.json",
				).toString();
		if (matchesFolder) {
			throw new Error(
				"ワークスペース直下の .pi/guardrails.json を開いてください。",
			);
		}
		const root = await realpath(folder.uri.fsPath);
		const matchesValue =
			(await canonicalPath(uri.fsPath, root)) !==
			resolve(root, ".pi/guardrails.json");
		if (matchesValue) {
			throw new Error("ガードレール設定のリンク先が変更されています。");
		}
		return root;
	}
	/** 文書内容の一致を確認した後に永続化し、同じ内容を実行側へ渡す。 */
	apply(root: string, text: string, isCurrent: () => boolean): Promise<void> {
		/** 保存前後で文書の世代を確認し、保存中の変更では以前の有効設定へ戻す。 */
		const applyCurrentGuardrails = async () => {
			const config = parseGuardrails(text);
			if (!isCurrent()) {
				throw new Error("文書が変更されました。再度適用してください。");
			}
			const key = `guardrails.v1:${root}`;
			const previous = this.state.get<string>(key);
			await this.state.update(key, JSON.stringify(config));
			if (!isCurrent()) {
				await this.state.update(key, previous);
				throw new Error(
					"適用中に文書が変更されました。再度適用してください。",
				);
			}
			guardrailRegistry.apply(root, config);
		};
		const operation = this.queue.then(applyCurrentGuardrails);
		this.queue = operation.catch(() => undefined);
		return operation;
	}
}
