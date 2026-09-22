// 接続先が公開したスキルだけを、明示的な入力コンテキストへ変換する。
import type { SkillSummary } from "../../../../shared/skills";
import type { UserInput } from "../codex-app-server/v2/UserInput";

/** 行頭の@スキル名に一致する候補を重複なく添付する。 */
export function skillInput(text: string, skills: SkillSummary[]): UserInput[] {
	const names = new Set(
		Array.from(text.matchAll(/^@([^\s]+)(?=\s|$)/gm), (match) => match[1]),
	);
	return skills
		.filter((skill) => names.has(skill.name))
		.map(({ name, path }) => ({ type: "skill", name, path }));
}
