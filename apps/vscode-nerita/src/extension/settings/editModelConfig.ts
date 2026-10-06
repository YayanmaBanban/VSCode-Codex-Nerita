// TOML のコメントや他の設定を保持して、モデル設定の通常テーブルを更新する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { parse } from "smol-toml";

/** 複数行の値を分断せず、完結した文に分ける。 */
function statementsOf(text: string): string[] {
	const statements: string[] = [];
	let pending = "";
	for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
		pending += line;
		try {
			parse(pending);
		} catch {
			continue;
		}
		statements.push(pending);
		pending = "";
	}
	if (pending !== "") {
		throw new Error("TOML の編集位置を特定できません。");
	}
	return statements;
}

/** 文字列内の # を避け、値の後のコメントだけを残す。 */
function commentOf(statement: string, key: string): string {
	for (
		let index = statement.indexOf("#");
		index >= 0;
		index = statement.indexOf("#", index + 1)
	) {
		try {
			if (Object.keys(parse(statement.slice(0, index))).includes(key)) {
				return statement.slice(index).trimEnd();
			}
		} catch {
			/* 値がまだ完結していない位置は読み飛ばす。 */
		}
	}
	return "";
}

/** 値の後に元のコメントを残す。 */
function replacement(
	statement: string,
	key: string,
	value: string,
	eol: string,
): string {
	const comment = commentOf(statement, key);
	return `${key} = ${JSON.stringify(value)}${comment !== "" ? ` ${comment}` : ""}${eol}`;
}

/** 末尾に設定を追加しても、直前の文と連結しないようにする。 */
function terminated(statement: string, eol: string): string {
	return statement.endsWith("\n") ? statement : statement + eol;
}

/** 通常テーブルの設定だけを書き換え、その他の記法は保存前に検証する。 */
export function editModelConfig(
	text: string,
	backend: "pi" | "codex",
	values: Record<string, string>,
): string {
	parse(text);
	const remaining = new Map(Object.entries(values));
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	let active = false;
	let found = false;
	let output = "";
	const additions = () => {
		const result = [...remaining]
			.map(([key, value]) => `${key} = ${JSON.stringify(value)}${eol}`)
			.join("");
		remaining.clear();
		return result;
	};
	for (const statement of statementsOf(text)) {
		if (/^\s*\[/.test(statement)) {
			if (active) {
				output += additions();
			}
			active = new RegExp(
				`^\\s*\\[\\s*(?:${backend}|"${backend}"|'${backend}')\\s*\\]`,
			).test(statement);
			found ||= active;
		}
		const key = active ? Object.keys(parse(statement))[0] : undefined;
		if (isNonEmptyString(key) && remaining.has(key)) {
			output += replacement(statement, key, remaining.get(key)!, eol);
			remaining.delete(key);
		} else {
			output += terminated(statement, eol);
		}
	}
	if (!found) {
		output += `${eol}[${backend}]${eol}`;
	}
	output += additions();
	// インラインテーブルなど編集対象外の形式を誤って上書きしない。
	parse(output);
	return output;
}
