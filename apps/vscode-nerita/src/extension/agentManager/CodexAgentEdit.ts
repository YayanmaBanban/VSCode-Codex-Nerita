// TOML の完結した文を単位として、定義・モデル・承認設定を更新する。
import { parse, stringify } from "smol-toml";
import type { AgentEdit } from "@nerita/shared/agentManager/config";

/** 複数行の文字列や配列に現れるキーを設定と誤認しない。 */
function statements(text: string) {
	const result: string[] = [];
	let pending = "";
	for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
		pending += line;
		try {
			parse(pending);
		} catch {
			continue;
		}
		result.push(pending);
		pending = "";
	}
	if (pending) {
		throw new Error("TOML の編集位置を特定できません。");
	}
	return result;
}

/** 値として完結する位置より後にあるコメントだけを保持する。 */
function trailingComment(statement: string): string {
	for (
		let index = statement.indexOf("#");
		index !== -1;
		index = statement.indexOf("#", index + 1)
	) {
		try {
			const parsed = parse(statement.slice(0, index));
			if (Object.keys(parsed).length) {
				return statement.slice(index).trimEnd();
			}
		} catch {
			/* 文字列内の # では値が完結しない。 */
		}
	}
	return "";
}

/** 削除する設定にコメントがある場合も、そのコメントは残す。 */
function replacement(
	name: string,
	value: unknown,
	statement: string,
	eol: string,
) {
	const comment = trailingComment(statement);
	if (value === undefined) {
		return comment ? `${comment}${eol}` : "";
	}
	return `${stringify({ [name]: value }).trimEnd()}${comment ? ` ${comment}` : ""}${eol}`;
}

/** 指定した設定だけを更新し、Pi 専用の項目はエラーとして拒否する。 */
export function editCodexAgent(text: string, edit: AgentEdit): string {
	if (edit.disabled !== undefined || edit.thinking !== undefined) {
		throw new Error("Codex の標準設定ではない項目が含まれています。");
	}
	parse(text);
	const values = new Map<string, unknown>([
		["model", edit.model],
		["model_reasoning_effort", edit.reasoningEffort],
	]);
	if (edit.definition) {
		values.set("name", edit.definition.name);
		values.set("description", edit.definition.description);
		values.set("developer_instructions", edit.definition.prompt);
	}
	values.set("sandbox_mode", edit.sandboxMode);
	values.set("approvals_reviewer", edit.approvalsReviewer);
	values.set("approval_policy", edit.approvalPolicy);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	let root = true;
	let approvalTable = false;
	const policy = values.get("approval_policy");
	// テーブル形式は末尾へ置き、後続のルート設定を取り込まない。
	if (typeof policy === "object") {
		values.set("approval_policy", undefined);
	}
	const output = statements(text)
		.map((statement) => {
			if (/^\s*\[/.test(statement)) {
				root = false;
				const table = parse(statement);
				approvalTable = "approval_policy" in table;
			}
			if (approvalTable) {
				return "";
			}
			const name = Object.keys(parse(statement))[0] ?? "";
			if (root && name === "approval_policy" && !values.has(name)) {
				return "";
			}
			if (!root || !values.has(name)) {
				return statement;
			}
			const value = values.get(name);
			values.delete(name);
			return replacement(name, value, statement, eol);
		})
		.join("");
	const additions = [...values]
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${stringify({ [key]: value }).trimEnd()}${eol}`)
		.join("");
	const result =
		additions +
		output +
		(typeof policy === "object"
			? `${eol}${stringify({ approval_policy: policy })}`
			: "");
	parse(result);
	return result;
}
