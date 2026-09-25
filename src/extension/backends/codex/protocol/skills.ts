// スキル一覧の必須フィールドを検証し、有効な候補だけを公開する。
import { isRecord } from "../../../../shared/validation";
import { validSkills, type SkillSummary } from "../../../../shared/skills";

/** App Server の一覧を表示と送信に共通の候補へ正規化する。 */
export function parseSkills(value: unknown): SkillSummary[] {
	if (!isRecord(value) || !Array.isArray(value.data)) {
		throw new Error("Invalid skills");
	}
	const skills: SkillSummary[] = [];
	for (const entry of value.data) {
		collectEnabledSkills(entry, skills);
	}
	return [...new Map(skills.map((skill) => [skill.path, skill])).values()];
}

/** 一覧のエントリーから有効なスキルを集める。 */
function collectEnabledSkills(entry: unknown, skills: SkillSummary[]) {
	if (!isRecord(entry) || !Array.isArray(entry.skills)) {
		throw new Error("Invalid skills entry");
	}
	for (const item of entry.skills) {
		if (
			!isRecord(item) ||
			typeof item.enabled !== "boolean" ||
			!validSkills([item])
		) {
			throw new Error("Invalid skill");
		}
		if (item.enabled) {
			skills.push({
				name: item.name as string,
				description: item.description as string,
				path: item.path as string,
			});
		}
	}
}
