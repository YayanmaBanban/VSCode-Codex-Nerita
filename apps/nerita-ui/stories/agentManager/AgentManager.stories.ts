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
export const BackendSwitch: Story = {
	args: { mode: "backend-switch" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("textbox", { name: "名前" }),
		).toHaveValue("writer");
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"codex-reviewer",
		);
		await expect(
			canvas.queryByRole("button", { name: "writer" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"writer",
		);
	},
};
export const Codex: Story = { args: { mode: "codex" } };
export const LoadErrors: Story = {
	args: { mode: "load-errors" },
	play: async ({ canvasElement }) => {
		await waitFor(() =>
			expect(within(canvasElement).getAllByRole("alert")).toHaveLength(2),
		);
	},
};
export const InitializationError: Story = {
	args: { mode: "initialization-error" },
	play: async ({ canvasElement }) => {
		await expect(
			await within(canvasElement).findByRole("alert"),
		).toBeVisible();
	},
};
export const SaveError: Story = {
	args: { mode: "conflict" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("textbox", { name: "説明" }),
			"-draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).toBeInTheDocument();
	},
};
export const InvalidHandoff: Story = {
	args: { mode: "invalid" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "ハンドオフ" }),
		);
		await expect(
			canvas.getByRole("button", { name: "初期値から設定を作り直す" }),
		).toBeVisible();
	},
};
export const HandoffEffortValidation: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "ハンドオフ" }),
		);
		const backend = within(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "モデル選択のモード" }),
			"fixed",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "モデル" }),
			"gpt-6-sol",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "推論レベル" }),
			"ultra",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "モデル" }),
			"gpt-6-luna",
		);
		await expect(backend.getByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "推論レベル" }),
			"high",
		);
		await expect(backend.queryByRole("alert")).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await waitFor(() =>
			expect(
				canvasElement.querySelector("footer .lucide-circle-check"),
			).toBeInTheDocument(),
		);
		await expect(canvas.getAllByRole("status")).toHaveLength(1);
	},
};
export const HandoffHelp: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "ハンドオフ" }),
		);
		const help = canvas.getByRole("button", {
			name: "ハンドオフ設定のヘルプ",
		});
		const panel = canvasElement.ownerDocument.getElementById(
			help.getAttribute("aria-controls") ?? "",
		);
		await expect(help).toHaveAttribute("aria-expanded", "false");
		await expect(panel).toHaveAttribute("aria-hidden", "true");
		await expect(panel).toHaveAttribute("inert");
		await userEvent.click(help);
		await expect(help).toHaveAttribute("aria-expanded", "true");
		await expect(panel).toHaveAttribute("aria-hidden", "false");
		await expect(panel).not.toHaveAttribute("inert");
		help.focus();
		await userEvent.keyboard(" ");
		await expect(help).toHaveAttribute("aria-expanded", "false");
		await expect(panel).toHaveAttribute("inert");
		const timeout = canvas.getByRole("spinbutton", {
			name: "タイムアウト（秒）",
		});
		await expect(timeout).toHaveValue(120);
		await userEvent.click(canvas.getByText("実行設定", { exact: true }));
		await expect(timeout).not.toBeVisible();
		await userEvent.click(canvas.getByText("実行設定", { exact: true }));
		await expect(timeout).toBeVisible();
	},
};
export const CodexDefaults: Story = {
	args: { mode: "codex-defaults" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6.1 Sol Medium");
		await expect(
			canvas.queryByRole("button", { name: "高度な設定" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", { name: "サンドボックスモード" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByText("権限と承認設定は親セッションから引き継ぎます。"),
		).toBeVisible();
		await userEvent.type(
			canvas.getByRole("textbox", { name: "説明" }),
			" draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const saved = args.onRequest.mock.calls.find(
			([request]) => request.type === "agent",
		)?.[0];
		if (saved?.type !== "agent") {
			throw new Error("保存要求がありません。");
		}
		await expect(saved.edit).not.toHaveProperty("sandboxMode");
		await expect(saved.edit).not.toHaveProperty("approvalsReviewer");
		await expect(saved.edit).not.toHaveProperty("approvalPolicy");
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
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).toBeInTheDocument();
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
		await expect(
			canvasElement.querySelector("footer .lucide-circle-check"),
		).toBeInTheDocument();
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).not.toBeInTheDocument();
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

export const Conflict: Story = {
	args: { mode: "conflict" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "writer-draft");
		await userEvent.click(canvas.getByRole("button", { name: "reviewer" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);

		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"設定が変更されています。再読み込みしてから保存してください。",
		);
		await expect(name).toHaveValue("writer-draft");
		await expect(
			canvas.getByRole("region", { name: "未保存の変更" }),
		).toBeInTheDocument();
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).toBeInTheDocument();
		await expect(
			canvasElement.querySelector("footer .lucide-circle-check"),
		).not.toBeInTheDocument();
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
			name: "タイムアウト（秒）",
		});
		await expect(timeout).toBeDisabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "初期値から設定を作り直す" }),
		);
		await expect(timeout).toBeEnabled();
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "15");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);

		await waitFor(() =>
			expect(
				canvasElement.querySelector("footer .lucide-circle-check"),
			).toBeInTheDocument(),
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
		await expect(handoff.config.defaults).toEqual({ timeoutMs: 15000 });
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
		await userEvent.click(canvas.getByRole("button", { name: "reviewer" }));
		await expect(
			canvas.getByRole("region", { name: "未保存の変更" }),
		).toBeInTheDocument();
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
		await expect(
			canvas.getByRole("button", { name: "updated-writer" }),
		).toHaveAttribute("aria-current", "page");
		await expect(
			canvasElement.querySelector("footer .lucide-circle-check"),
		).toBeInTheDocument();
		await expect(canvasElement.querySelector("footer")).toHaveAttribute(
			"data-phase",
			"shown",
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "未保存の変更" }),
			).not.toBeInTheDocument(),
		);

		const description = canvas.getByRole("textbox", { name: "説明" });
		await userEvent.clear(description);
		await userEvent.type(description, "renamed agent description");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "agent",
				agentId: "pi:updated-writer",
			}),
		);
	},
};
