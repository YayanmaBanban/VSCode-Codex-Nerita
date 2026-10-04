// チャットと Agent Manager で共通のモデル・権限カードの宣言を生成する。
import type { ConfigChoice, ConfigOption } from "./composer";
import type { NeritaUiControl } from "./uiContributions";

/** Codex の保存値と日本語表示を、チャットと管理画面で揃える。 */
export const codexSandboxChoices: ConfigChoice[] = [
	{ value: "read-only", name: "読み取り専用" },
	{ value: "workspace-write", name: "ワークスペース内に書き込み" },
	{ value: "danger-full-access", name: "フルアクセス" },
];

/** 承認者の候補・アイコン・説明を両画面へ同じ形式で渡す。 */
export const codexReviewerChoices: ConfigChoice[] = [
	{
		value: "user",
		icon: "user",
		name: "ユーザが承認",
		description: "追加の権限が必要な操作は、実行前に確認します。",
	},
	{
		value: "auto_review",
		icon: "bot",
		name: "代わりに承認",
		description:
			"操作を自動レビューし、リスクに応じて承認します。\n追加のトークンを使用します。",
	},
];

/** 推論の保存値を変えず、表示名だけ先頭を大文字にする。 */
export function reasoningLabel(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 推論候補は選択中モデルに対応したものを渡す。 */
export function modelControl(
	model: ConfigOption,
	options: ConfigOption[],
): Extract<NeritaUiControl, { type: "slider-card" }> {
	const effort = options.find((option) => option.id === "reasoning_effort")!;
	return { type: "slider-card", icon: "model", model, option: effort };
}

/** ワークスペースへの書込み時だけ承認者を選択できる。 */
export function permissionControl(
	option: ConfigOption,
	options: ConfigOption[],
): Extract<NeritaUiControl, { type: "slider-card" }> {
	const reviewer = options.find((item) => item.id === "approvals_reviewer");
	const warning = option.currentValue === "danger-full-access";
	return {
		type: "slider-card",
		option,
		icon: warning ? "shield-alert" : "shield",
		warning,
		secondary:
			option.currentValue === "workspace-write" && reviewer
				? {
						option: reviewer,
						icon:
							reviewer.options.find(
								(choice) =>
									choice.value === reviewer.currentValue,
							)?.icon ?? "user",
					}
				: undefined,
	};
}
