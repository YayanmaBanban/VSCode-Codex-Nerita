// ストーリーの表示用に、接続応答と同じ構造の設定例を定義する。
import type { ConfigOption } from "@nerita/shared/composer";

/** 表示名と送信値が異なる設定候補を作る。 */
export function settingsFixture(): ConfigOption[] {
	return [
		{
			id: "mode",
			name: "Mode",
			currentValue: "workspace-write",
			options: [
				{ value: "read-only", name: "読み取り専用" },
				{
					value: "workspace-write",
					name: "ワークスペース内に書き込み",
				},
				{ value: "danger-full-access", name: "フルアクセス" },
			],
		},
		{
			id: "approvals_reviewer",
			name: "ApprovalsReviewer",
			currentValue: "user",
			options: [
				{
					value: "user",
					icon: "user",
					name: "ユーザが承認",
					description:
						"追加の権限が必要な操作は、実行前に確認します。",
				},
				{
					value: "auto_review",
					icon: "bot",
					name: "代わりに承認",
					description:
						"操作を自動レビューし、リスクに応じて承認します。\n追加のトークンを使用します。",
				},
			],
		},
		{
			id: "collaboration_mode",
			name: "Collaboration mode",
			currentValue: "default",
			options: [
				{ value: "default", name: "Default" },
				{
					value: "plan",
					name: "Plan",
					description: "Plan before making changes",
				},
				{ value: "goal", name: "Goal" },
			],
		},
		{
			id: "model",
			name: "Model",
			currentValue: "gpt-6-astra",
			options: [
				{
					value: "gpt-6-astra",
					name: "6 Astra",
					description:
						"Our most capable model for complex, demanding work.",
				},
				{
					value: "gpt-5.6-luna",
					name: "5.6 Luna",
					description: "Fast and affordable agentic coding model.",
				},
			],
		},
		{
			id: "reasoning_effort",
			name: "Reasoning effort",
			currentValue: "low",
			options: [
				{
					value: "low",
					name: "Low",
					description: "Fast responses with lighter reasoning",
				},
				{ value: "high", name: "High" },
				{ value: "ultra", name: "Ultra" },
			],
		},
		{
			id: "fast-mode",
			name: "Fast mode",
			currentValue: "off",
			description: "1.5x speed, increased usage",
			options: [
				{
					value: "off",
					name: "Off",
					description: "Default speed, normal usage",
				},
				{
					value: "on",
					name: "On",
					description: "1.5x speed, increased usage",
				},
			],
		},
	];
}
