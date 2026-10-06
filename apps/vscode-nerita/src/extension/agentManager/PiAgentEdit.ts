// プロジェクトの Markdown 定義のメタデータと本文だけを編集する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { parseDocument } from "yaml";
import type { AgentEdit } from "@nerita/shared/agentManager/config";

/** YAML の未知の項目とコメントを保持し、本文は入力どおりに保存する。 */
export function editPiAgent(text: string | undefined, edit: AgentEdit): string {
	if (!edit.definition) {
		throw new Error("Agent の名前・説明・プロンプトが必要です。");
	}
	assertPiEdit(edit);
	const document = piDocument(text);
	document.set("name", edit.definition.name);
	document.set("description", edit.definition.description);
	if (text === undefined) {
		if (isNonEmptyString(edit.model)) {
			document.set("model", edit.model);
		}
		if (edit.thinking !== undefined) {
			document.set("thinking", edit.thinking);
		}
	}
	const result = `---\n${document.toString()}---\n${edit.definition.prompt}`;
	if (Buffer.byteLength(result, "utf8") > 65536) {
		throw new Error("Agent 定義は64 KiB以内にしてください。");
	}
	return result;
}

/** 複数行の YAML もパーサーで検証してから編集する。 */
function piDocument(text: string | undefined) {
	const match = text?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (text !== undefined && !match) {
		throw new Error("Agent 定義の frontmatter が不正です。");
	}
	const document = parseDocument(match?.[1] ?? "{}");
	if (document.errors.length > 0) {
		throw new Error("Agent 定義の YAML が不正です。");
	}
	return document;
}

/** Pi の保存要求に Codex 専用の設定が含まれていたら、エラーを返す。 */
export function assertPiEdit(edit: AgentEdit) {
	if (
		edit.reasoningEffort !== undefined ||
		edit.sandboxMode !== undefined ||
		edit.approvalsReviewer !== undefined ||
		edit.approvalPolicy !== undefined
	) {
		throw new Error("Pi に Codex 専用設定は保存できません。");
	}
}
