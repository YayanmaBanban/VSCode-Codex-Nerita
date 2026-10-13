// 実際の管理画面で保存・競合・入力エラーを確認する。
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import type { ManagerRequest } from "@nerita/shared/agentManager/messages";
import Preview from "./AgentManagerPreview.svelte";

const meta = {
	title: "Agent Manager",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: {
		mode: "normal",
		onRequest: fn<(message: ManagerRequest) => void>(),
	},
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<{
	mode: string;
	onRequest: ReturnType<typeof fn<(message: ManagerRequest) => void>>;
}>;
export const Settings: Story = {};
export const Codex: Story = { args: { mode: "codex" } };
export const CodexDefaults: Story = {
	args: { mode: "codex-defaults" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6.1 Sol Medium");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await expect(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
		).toHaveValue("on-request");
		await expect(
			canvas.queryByRole("option", { name: "未指定" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "サンドボックスモード" }),
		);
		await expect(
			page.getByRole("slider", { name: "サンドボックスモード" }),
		).toHaveAttribute("aria-valuetext", "読み取り専用");
		await expect(
			page.queryByRole("combobox", { name: "承認者" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			page.getByRole("button", { name: "サンドボックスモード: 2" }),
		);
		const reviewer = await page.findByRole("combobox", { name: "承認者" });
		await userEvent.click(reviewer);
		await expect(
			page.getByRole("option", { name: /代わりに承認/ }),
		).toHaveAttribute("aria-selected", "true");
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const saved = args.onRequest.mock.calls.find(
			([request]) => request.type === "agent",
		)?.[0];
		if (saved?.type !== "agent") {
			throw new Error("エージェント設定の保存要求がありません。");
		}
		await expect(saved.edit).toMatchObject({
			sandboxMode: "workspace-write",
			approvalsReviewer: "auto_review",
		});
	},
};
export const CodexPermissions: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6 Sol High");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.click(
			canvas.getByRole("button", { name: "サンドボックスモード" }),
		);
		await expect(
			page.queryByRole("combobox", { name: "承認者" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			page.getByRole("button", { name: "サンドボックスモード: 2" }),
		);
		await userEvent.click(
			await page.findByRole("combobox", { name: "承認者" }),
		);
		await userEvent.click(
			await page.findByRole("option", { name: /代わりに承認/ }),
		);
		const slider = page.getByRole("slider", {
			name: "サンドボックスモード",
		});
		await expect(slider).toHaveAttribute(
			"aria-valuetext",
			"ワークスペース内に書き込み",
		);
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent",
				edit: {
					model: "gpt-6-sol",
					reasoningEffort: "high",
					sandboxMode: "workspace-write",
					approvalsReviewer: "auto_review",
					approvalPolicy: "on-request",
					definition: {
						name: "codex-reviewer",
						description: "Codex の標準定義",
						prompt: "変更内容と関連テストを確認してください。",
					},
				},
			}),
		);
	},
};
export const CodexEditing: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", {
			name: "名前",
		});
		await expect(
			canvas.queryByRole("button", { name: "Pi" }),
		).not.toBeInTheDocument();
		await userEvent.clear(name);
		await userEvent.type(name, "updated-reviewer");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.selectOptions(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
			"granular",
		);
		await userEvent.click(
			canvas.getByRole("checkbox", { name: "サンドボックス外での実行" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("status")).toHaveTextContent(
				"保存しました",
			),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"updated-reviewer",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await expect(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		).toBeInTheDocument();
		await expect(
			canvas.queryByRole("region", { name: "pi ハンドオフ" }),
		).not.toBeInTheDocument();
	},
};
export const ApprovalInteractions: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const advanced = await canvas.findByRole("button", {
			name: "高度な設定",
		});
		await expect(advanced).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(advanced);
		const policy = canvas.getByRole("combobox", { name: "承認ポリシー" });
		for (const [value, description] of [
			["on-request", "サンドボックス外の実行操作で承認を求める"],
			["never", "承認なし"],
			["granular", "承認の種類ごとに決める"],
		] as const) {
			await userEvent.selectOptions(policy, value);
			await userEvent.unhover(policy);
			await userEvent.hover(policy);
			await expect(await page.findByRole("tooltip")).toHaveTextContent(
				description,
			);
			await userEvent.unhover(policy);
			await userEvent.keyboard("{Escape}");
		}
		const checkbox = canvas.getByRole("checkbox", {
			name: "サンドボックス外での実行",
		});
		await expect(checkbox).toBeChecked();
		await userEvent.click(checkbox);
		await expect(checkbox).not.toBeChecked();
		await userEvent.keyboard(" ");
		await expect(checkbox).toBeChecked();
		await userEvent.click(advanced);
		await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
		await userEvent.click(advanced);
		await expect(checkbox).toBeChecked();
	},
};
export const Conflict: Story = {
	args: { mode: "conflict" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "writer-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);

		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"設定が変更されています。再読み込みしてから保存してください。",
		);
		await expect(name).toHaveValue("writer-draft");
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent",
				agentId: "pi:writer",
				generation: "1",
			}),
		);
	},
};
export const Invalid: Story = {
	args: { mode: "invalid" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		const timeout = canvas.getByRole("spinbutton", {
			name: "Timeout (ms)",
		});
		await expect(timeout).toBeDisabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "初期値から設定を作り直す" }),
		);
		await expect(timeout).toBeEnabled();
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "1500");
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ設定を保存" }),
		);

		await expect(await canvas.findByRole("status")).toHaveTextContent(
			"保存しました。",
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "handoff",
				backend: "pi",
			}),
		);
		const handoff = args.onRequest.mock.calls.find(
			([request]) => request.type === "handoff",
		)?.[0];
		if (handoff?.type !== "handoff") {
			throw new Error("ハンドオフ設定の保存要求がありません。");
		}
		await expect(handoff.config.defaults).toEqual({ timeoutMs: 1500 });
	},
};
export const Empty: Story = { args: { mode: "empty" } };

export const NewCodex: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.click(
			canvas.getByRole("button", { name: "新しいエージェントを追加" }),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"new-agent",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "ファイル名" }),
			"new-agent",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "説明" }),
			"新しい説明",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "システムプロンプト" }),
			"テストを確認してください。",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "createAgent",
				backend: "codex",
				filename: "new-agent",
				edit: {
					model: "gpt-6.1-sol",
					reasoningEffort: "medium",
					sandboxMode: "read-only",
					approvalsReviewer: "auto_review",
					approvalPolicy: "on-request",
					definition: {
						name: "new-agent",
						description: "新しい説明",
						prompt: "テストを確認してください。",
					},
				},
			}),
		);
	},
};

export const UnsavedChanges: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.type(name, "-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await expect(
			canvas.getByRole("region", { name: "未保存の変更" }),
		).toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "編集を続ける" }),
		);
		await expect(name).toHaveValue("codex-reviewer-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を破棄" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
				"codex-reviewer",
			),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"-draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を破棄" }),
		);
		await expect(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		).toBeInTheDocument();
	},
};

export const PiEditing: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("button", { name: "writer" });
		await userEvent.click(canvas.getByRole("button", { name: "writer" }));
		await userEvent.clear(canvas.getByRole("textbox", { name: "名前" }));
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"updated-writer",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent",
				agentId: "pi:writer",
				edit: {
					definition: {
						name: "updated-writer",
						description: "プロジェクトの Agent",
						prompt: "文書を編集してください。",
					},
				},
			}),
		);
	},
};
