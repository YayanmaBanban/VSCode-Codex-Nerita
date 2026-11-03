// 適用中の設定で文書を復元して保存し、実行設定や既存の承認は変更しない。
import type { TextDocument } from "vscode";
import { parseGuardrails } from "@nerita/shared/guardrails/config";

/** 復元元と文書の世代を検査し、競合や保存失敗を成功として扱わない。 */
export async function discardGuardrails(
	document: Pick<TextDocument, "getText" | "save" | "isDirty" | "version">,
	version: number,
	activeText: string,
	isActive: () => boolean,
	replace: (text: string) => Promise<boolean>,
) {
	const config = parseGuardrails(activeText);
	// 未保存の編集も明示的な復元対象とし、編集中かどうかではなく要求時の版で競合を判定する。
	const stale = document.version !== version || !isActive();
	if (stale) {
		throw new Error(
			"文書または適用中の設定が変更されています。最新の内容を確認してください。",
		);
	}
	const text = `${JSON.stringify(config, null, 2)}\n`;
	const replaced = await replace(text);
	if (!replaced) {
		throw new Error("適用中の設定へ復元できませんでした。");
	}
	const restoredVersion = document.version;
	const changed = document.getText() !== text || !isActive();
	if (changed) {
		throw new Error(
			"復元中に設定が変更されました。内容を確認してください。",
		);
	}
	const saved = await document.save();
	const current =
		isRestoredDocument(document, text, restoredVersion) && isActive();
	if (!saved || !current) {
		throw new Error(
			"復元した内容を保存できませんでした。文書の状態を確認してください。",
		);
	}
}

/** 保存時の整形や外部更新も、復元を確認していない別の文書として扱う。 */
function isRestoredDocument(
	document: Pick<TextDocument, "getText" | "isDirty" | "version">,
	text: string,
	version: number,
) {
	return (
		!document.isDirty &&
		document.version === version &&
		document.getText() === text
	);
}
