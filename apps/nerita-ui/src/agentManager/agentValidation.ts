// 保存スキーマの検証エラーを入力欄ごとに分け、修正が必要な理由を利用者向けの文章で示す。
import type { z } from "zod";
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";

/** エージェント定義・設定の検証エラーを表示する入力欄の識別子。 */
type AgentField = "name" | "description" | "prompt" | "settings";
const labels = {
	name: "名前",
	description: "説明",
	prompt: "システムプロンプト",
	settings: "設定",
};

/** 定義の入力欄に対応しないエラーは、設定欄へまとめる。 */
function issueField(issue: z.core.$ZodIssue): AgentField {
	if (issue.path[0] !== "definition") {
		return "settings";
	}
	const field = issue.path[1];
	switch (field) {
		case "name":
		case "description":
		case "prompt":
			return field;
		case undefined:
		default:
			return "settings";
	}
}

/** 文字列の空欄・長さと不正な設定値を、対象名付きの文章へ変換する。 */
function issueMessage(issue: z.core.$ZodIssue, field: AgentField) {
	const label =
		field === "settings" ? settingLabel(issue.path[0]) : labels[field];
	if (issue.code === "too_small") {
		return `${label}が空欄です。`;
	}
	if (issue.code === "too_big") {
		return `${label}は${issue.maximum}文字以内で入力してください。`;
	}
	if (issue.code === "unrecognized_keys") {
		return `未対応の設定項目があります: ${issue.keys.join("、")}。`;
	}
	return `${label}の値が無効です。入力し直してください。`;
}

/** 保存キーを利用者向けの設定名へ置き換える。 */
function settingLabel(key: PropertyKey | undefined) {
	if (key === "model") {
		return "モデル";
	}
	if (key === "thinking" || key === "reasoningEffort") {
		return "推論レベル";
	}
	if (key === "disabled") {
		return "有効／無効の設定";
	}
	return "エージェント設定";
}

/** 保存時と同じスキーマを使い、各入力欄の最初のエラーを返す。 */
export function agentFieldErrors(edit: AgentEdit) {
	const parsed = agentEditSchema.safeParse(edit);
	const errors: Partial<Record<AgentField, string>> = {};
	if (parsed.success) {
		return errors;
	}
	for (const issue of parsed.error.issues) {
		const field = issueField(issue);
		errors[field] ??= issueMessage(issue, field);
	}
	return errors;
}

/** 新規ファイル名の空欄・長さ・利用できない文字を区別する。 */
export function agentFilenameError(filename: string) {
	if (filename.trim() === "") {
		return "ファイル名が空欄です。";
	}
	if (filename.length > 80) {
		return "ファイル名は80文字以内で入力してください。";
	}
	if (!/^[a-z0-9][\w-]*$/i.test(filename)) {
		return "ファイル名は半角英数字で始め、半角英数字・ハイフン・アンダースコアだけで入力してください（拡張子は不要です）。";
	}
	return undefined;
}
