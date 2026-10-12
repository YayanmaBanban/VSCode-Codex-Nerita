// 通常のコピーで元の座標を記録し、Webview の貼り付け本文と照合する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { win32 } from "node:path";
import type { WorkspacePath } from "@nerita/shared/workspacePaths";

/** クリップボードの改行差だけを吸収し、本文自体は保持しない。 */
function fingerprint(text: string): string {
	return createHash("sha256")
		.update(text.replace(/\r\n?/g, "\n"))
		.digest("hex");
}

/** コピー元はウィンドウ内の直近一件に限定し、終了時に破棄する。 */
export class CopiedCode implements vscode.Disposable {
	private copied: { entry: WorkspacePath; hash: string } | undefined;
	private registration: vscode.Disposable;
	/** 標準コピーを置き換えず、VS Code のコピー通知に参加する。 */
	constructor() {
		/** ローカルの一つの非空選択だけを記録し、本文は保持せず貼り付け時の照合用ハッシュを付ける。 */
		const captureCopiedCode: NonNullable<
			vscode.DocumentPasteEditProvider["prepareDocumentPaste"]
		> = (document, ranges, dataTransfer, token) => {
			this.copied = undefined;
			const range = ranges[0];

			if (token.isCancellationRequested) {
				return;
			}
			if (ranges.length !== 1) {
				return;
			}
			if (!range) {
				return;
			}

			if (range.isEmpty) {
				return;
			}
			if (document.uri.scheme !== "file") {
				return;
			}
			if (isNonEmptyString(vscode.env.remoteName)) {
				return;
			}
			const text = document.getText(range);
			if (text.trim() === "" || text.length > 100_000) {
				return;
			}
			const entry: WorkspacePath = {
				uri: document.uri.toString(),
				path: document.uri.fsPath,
				name: win32.basename(document.uri.fsPath),
				kind: "file",
				range: {
					start: {
						line: range.start.line,
						character: range.start.character,
					},
					end: {
						line: range.end.line,
						character: range.end.character,
					},
				},
			};
			this.copied = { entry, hash: fingerprint(text) };
			// このメタデータは VS Code 内だけで有効。Webview では Host の記録を照合する。
			dataTransfer.set(
				"application/vnd.nerita.code-reference",
				new vscode.DataTransferItem(entry.uri),
			);
		};
		this.registration = vscode.languages.registerDocumentPasteEditProvider(
			"*",
			{
				prepareDocumentPaste: captureCopiedCode,
			},
			{
				providedPasteEditKinds: [],
				copyMimeTypes: ["application/vnd.nerita.code-reference"],
				pasteMimeTypes: [],
			},
		);
	}

	/** コピー後に元の範囲が変わった場合は、誤った参照を作らない。 */
	async resolve(text: string): Promise<WorkspacePath | null> {
		const copied = this.copied;
		if (!copied || fingerprint(text) !== copied.hash) {
			return null;
		}
		try {
			const document = await vscode.workspace.openTextDocument(
				vscode.Uri.parse(copied.entry.uri),
			);
			const { start, end } = copied.entry.range!;
			const range = new vscode.Range(
				start.line,
				start.character,
				end.line,
				end.character,
			);

			if (!(this.copied === copied)) {
				return null;
			}
			if (!document.validateRange(range).isEqual(range)) {
				return null;
			}
			if (!(fingerprint(document.getText(range)) === copied.hash)) {
				return null;
			}
			return copied.entry;
		} catch {
			return null;
		}
	}

	/** 登録とコピー元の記録を同時に解放する。 */
	dispose(): void {
		this.registration.dispose();
		this.copied = undefined;
	}
}
