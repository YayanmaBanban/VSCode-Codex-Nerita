// 性格設定のプリセットと、両端で検証する通信契約を定義する。
/** 指示文を名前で保存するプリセット。 */
export type PersonalityPreset = { name: string; text: string };
/** 一つの保存先と設定ファイルによる固定状態。 */
export type PersonalityScope = {
	presets: PersonalityPreset[];
	selected: string;
	configuredText: string | null;
};
/** グローバルとワークスペースの設定。 */
export type PersonalitySettings = {
	global: PersonalityScope;
	workspace: PersonalityScope;
};
/** 読み込み・選択・保存の要求。パスはHost側で確定する。 */
export type PersonalityMessage =
	| { type: "personality/read"; requestId: string }
	| {
			type: "personality/select";
			requestId: string;
			scope: "global" | "workspace";
			name: string;
	  }
	| {
			type: "personality/save";
			requestId: string;
			scope: "global" | "workspace";
			name: string;
			text: string;
			originalName: string;
	  };
/** 配列やnullを除外する。 */
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 保存可能なプリセットの長さと名前を確認する。 */
export function isPersonalityPreset(
	value: unknown,
): value is PersonalityPreset {
	return (
		record(value) &&
		typeof value.name === "string" &&
		value.name.trim().length > 0 &&
		value.name.length <= 200 &&
		typeof value.text === "string" &&
		value.text.length <= 100_000
	);
}
/** Hostから受け取る設定を入れ子まで検証する。 */
export function isPersonalitySettings(
	value: unknown,
): value is PersonalitySettings {
	return (
		record(value) &&
		[value.global, value.workspace].every(
			(scope) =>
				record(scope) &&
				Array.isArray(scope.presets) &&
				scope.presets.every(isPersonalityPreset) &&
				typeof scope.selected === "string" &&
				(scope.configuredText === null ||
					typeof scope.configuredText === "string"),
		)
	);
}
/** グローバル、ワークスペースの順で有効な指示を結合する。 */
export function composeDeveloperInstructions(
	settings: PersonalitySettings,
): string {
	return [settings.global, settings.workspace]
		.map(
			(scope) =>
				scope.configuredText ??
				scope.presets.find((preset) => preset.name === scope.selected)
					?.text ??
				"",
		)
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
}
