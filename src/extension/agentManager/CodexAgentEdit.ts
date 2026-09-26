// TOML の完結した文を単位として、ルート直下のモデル設定だけを置き換える。
import { parse } from "smol-toml";
import type { AgentEdit } from "../../shared/agentManager/config";

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
	value: string | undefined,
	statement: string,
	eol: string,
) {
	const comment = trailingComment(statement);
	if (value === undefined) {
		return comment ? `${comment}${eol}` : "";
	}
	return `${name} = ${JSON.stringify(value)}${comment ? ` ${comment}` : ""}${eol}`;
}

/** 定義本文を保持し、Pi 専用のフィールドを標準 TOML へ混入させない。 */
export function editCodexAgent(text: string, edit: AgentEdit): string {
	if (edit.disabled !== undefined || edit.thinking !== undefined) {
		throw new Error("Codex の標準設定ではない項目が含まれています。");
	}
	parse(text);
	const values = new Map<string, string | undefined>([
		["model", edit.model],
		["model_reasoning_effort", edit.reasoningEffort],
	]);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	let root = true;
	const output = statements(text)
		.map((statement) => {
			if (/^\s*\[/.test(statement)) {
				root = false;
			}
			const name = assignmentKey(statement);
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
		.map(([key, value]) => `${key} = ${JSON.stringify(value)}${eol}`)
		.join("");
	const result = additions + output;
	parse(result);
	return result;
}

/** 引用付きキーも受け付け、テーブル内の指定と区別する。 */
function assignmentKey(statement: string) {
	const key = /^\s*(?:([\w-]+)|"([\w-]+)"|'([\w-]+)')\s*=/.exec(statement);
	return key?.[1] ?? key?.[2] ?? key?.[3] ?? "";
}
