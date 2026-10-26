// 検証した文書を保存し、保存中に変更されていない内容だけを実行設定へ渡す。
import type { TextDocument } from "vscode";
import { parseGuardrails } from "@nerita/shared/guardrails/config";
import { errorText } from "@nerita/shared/errorText";

/** 保存失敗・文書競合では適用を呼ばず、適用中も同じ保存済み文書かを確認できるようにする。 */
export async function saveGuardrails(
	document: Pick<TextDocument, "getText" | "save" | "isDirty" | "version">,
	version: number,
	apply: (text: string, isCurrent: () => boolean) => Promise<void>,
) {
	const text = document.getText();
	const config = parseGuardrails(text);
	const saved = await document.save();
	if (!saved) {
		throw new Error("保存できませんでした。");
	}
	/** 保存時の自動整形や外部編集も、確認していない別の設定として扱う。 */
	const isCurrent = () =>
		!document.isDirty &&
		document.version === version &&
		document.getText() === text;
	if (!isCurrent()) {
		throw new Error(
			"保存中に文書が変更されました。内容を確認し、もう一度「保存して適用」を実行してください。",
		);
	}
	try {
		await apply(text, isCurrent);
	} catch (error) {
		throw new Error(
			`保存しましたが、適用できませんでした: ${errorText(error)}`,
			{ cause: error },
		);
	}
	return config;
}
