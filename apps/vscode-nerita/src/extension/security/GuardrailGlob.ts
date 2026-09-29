// 制限した glob を動的計画法で照合し、ユーザー指定の正規表現は実行しない。
import { basename } from "node:path";

/** 単一の * は一階層、二重の * は階層をまたいで一致する。 */
export function matchPath(pattern: string, input: string): boolean {
	const normalize = (value: string) =>
		process.platform === "win32" ? value.toLowerCase() : value;
	const target = normalize(pattern.includes("/") ? input : basename(input));
	if (target.length > 4096) {
		return false;
	}
	const tokens = normalize(pattern).match(/\*\*\/|\*\*|./g) ?? [];
	let row = Array<boolean>(target.length + 1).fill(false);
	row[0] = true;
	for (const token of tokens) {
		row =
			token === "**/"
				? directories(row, target)
				: advance(row, target, token);
	}
	return row[target.length]!;
}

/** 任意階層を消費するか、階層を1つも消費しない候補を残す。 */
function directories(row: boolean[], target: string): boolean[] {
	let previous = false;
	return row.map((matched, index) => {
		const next = matched || (previous && target[index - 1] === "/");
		previous ||= matched;
		return next;
	});
}

/** ワイルドカードの消費位置を一行ずつ計算する。 */
function advance(row: boolean[], target: string, token: string): boolean[] {
	const next = Array<boolean>(target.length + 1).fill(false);
	const star = token === "*" || token === "**";
	next[0] = star && row[0]!;
	for (let i = 1; i <= target.length; i++) {
		if (star) {
			next[i] =
				row[i]! ||
				(next[i - 1]! && (token === "**" || target[i - 1] !== "/"));
		} else {
			next[i] = row[i - 1]! && matchesCharacter(token, target[i - 1]!);
		}
	}
	return next;
}

/** 単一文字のワイルドカードは区切り以外の1文字だけに一致する。 */
function matchesCharacter(token: string, character: string): boolean {
	return token === character || (token === "?" && character !== "/");
}
