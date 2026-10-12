// 性格設定のプリセットと、Host と Webview で検証する通信契約を定義する。
import { isRecord } from "./validation";

/** 指示文を名前で保存するプリセット。 */
export type PersonalityPreset = { name: string; text: string };

/** 保存先ごとのプリセット一覧・選択状態と、設定ファイルで指定された指示文。 */
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

/** 読み込み・選択・保存の要求。パスは Host 側で確定する。 */
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

/** 保存可能なプリセットの長さと名前を確認する。 */
export function isPersonalityPreset(
	value: unknown,
): value is PersonalityPreset {
	if (!isRecord(value)) {
		return false;
	}
	if (!(typeof value.name === "string")) {
		return false;
	}
	if (!(value.name.trim().length > 0)) {
		return false;
	}
	return (
		value.name.length <= 200 &&
		typeof value.text === "string" &&
		value.text.length <= 100_000
	);
}

/** Host から受け取る設定を入れ子まで検証する。 */
export function isPersonalitySettings(
	value: unknown,
): value is PersonalitySettings {
	if (!isRecord(value)) {
		return false;
	}
	return [value.global, value.workspace].every(isPersonalityScope);
}

/** 保存先ごとのプリセットと選択を検証し、設定ファイル由来の指示は null または文字列に限定する。 */
function isPersonalityScope(scope: unknown): scope is PersonalityScope {
	if (!isRecord(scope)) {
		return false;
	}
	if (!Array.isArray(scope.presets)) {
		return false;
	}
	if (!scope.presets.every(isPersonalityPreset)) {
		return false;
	}
	if (typeof scope.selected !== "string") {
		return false;
	}
	return (
		scope.configuredText === null ||
		typeof scope.configuredText === "string"
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
