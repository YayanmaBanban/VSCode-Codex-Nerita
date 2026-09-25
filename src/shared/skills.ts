// スキル候補を実行環境に依存しない表示用の型で共有する。

/** 接続先が有効として公開したスキル。 */
export type SkillSummary = { name: string; description: string; path: string };

/** Host から渡されたスキル候補の必須フィールドを検証する。 */
export function validSkills(value: unknown): value is SkillSummary[] {
	return (
		Array.isArray(value) &&
		value.every((item: unknown) => {
			if (!item || typeof item !== "object") {
				return false;
			}
			const skill = item as Record<string, unknown>;
			return (
				typeof skill.name === "string" &&
				typeof skill.description === "string" &&
				typeof skill.path === "string"
			);
		})
	);
}
