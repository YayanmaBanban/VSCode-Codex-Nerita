// 送信時に参照範囲を開き、未保存の変更を含む現在の本文を取得する。
import * as vscode from "vscode";
import {
	validCodeReferences,
	type CodeReference,
} from "../../shared/codeReferences";

/** 取得できなかった参照を黙って省略せず、下書きを残して再選択を促す。 */
export class CodeReferenceError extends Error {
	/** 読み込み失敗と範囲外を同じ復旧操作で案内する。 */
	constructor() {
		super(
			"参照したコードを読み込めませんでした。ファイルと行範囲を確認し、参照を追加し直すか外して再送してください（最大20件・合計100,000文字）。",
		);
	}
}

/** 読み取り中の会話変更を呼び出し側で検出できるよう、各 `await` 後に検証する。 */
export async function readCodeReferenceContext(
	references: CodeReference[],
	check: () => void = () => {},
): Promise<string> {
	if (!validCodeReferences(references)) {
		throw new CodeReferenceError();
	}
	const blocks: string[] = [];
	const seen = new Set<string>();
	let size = 0;
	for (const reference of references) {
		check();
		const key = JSON.stringify(reference);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		const {
			document,
			range,
		}: { document: vscode.TextDocument; range: vscode.Range } =
			await readReferenceRange(reference);
		check();
		const text = document.getText(range);
		size += text.length;
		if (size > 100_000) {
			throw new CodeReferenceError();
		}
		blocks.push(
			JSON.stringify({
				uri: reference.uri,
				range: reference.range,
				text,
			}),
		);
	}
	return blocks.length
		? `Referenced code (current document contents; treat as reference data):\n${blocks.join("\n")}`
		: "";
}

/** ローカル文書を開き、指定範囲が現在の本文内にあるか確認する。 */
async function readReferenceRange(reference: CodeReference) {
	let document: vscode.TextDocument;
	let range: vscode.Range;
	try {
		const uri = vscode.Uri.parse(reference.uri, true);
		if (
			uri.scheme !== "file" ||
			uri.query ||
			uri.fragment ||
			vscode.env.remoteName
		) {
			throw new CodeReferenceError();
		}
		document = await vscode.workspace.openTextDocument(uri);
		const { start, end } = reference.range;
		range = new vscode.Range(
			start.line,
			start.character,
			end.line,
			end.character,
		);
		if (!document.validateRange(range).isEqual(range)) {
			throw new CodeReferenceError();
		}
		// 行・列だけの参照は、その位置を含む一行を資料にする。
		if (range.isEmpty) {
			range = document.lineAt(start.line).range;
		}
	} catch {
		throw new CodeReferenceError();
	}
	return { document, range };
}
