// Storybook は別の Host として表示情報を注入し、製品のプラットフォーム文言を複製しない。
import type { HostPresentation } from "@nerita/shared/hostPresentation";

export const storyHostPresentation: HostPresentation = {
	credentialStorageLabels: {
		session: "検証用メモリーのみ",
		"secret-storage": "検証ホストに保存",
	},
	autoReviewStorageDescription:
		"設定は検証ホストのワークスペース領域で管理します。",
	guardrailsRepairDescription:
		"設定ファイルを検証ホストの編集画面で修正してください。",
	trust: {
		codexStorageDescription: "Codex: 検証ホストの共通設定に保存",
		piStorageDescription: "Pi: 検証ホストの信頼領域に保存",
		piStorageKey: "fixture.trust",
	},
	authentication: {
		codex: {
			required: "検証ホストで認証方式を選択してください。",
			pending: "検証ホストで認証を続けてください。",
		},
		pi: {
			required: "検証ホストの認証設定を開いてください。",
			pending: "検証ホストの認証設定で入力を続けてください。",
		},
	},
};
