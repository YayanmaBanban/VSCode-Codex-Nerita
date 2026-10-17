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
			backend.getByRole("combobox", { name: "codex Strategy" }),
			"fixed",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "codex Model" }),
			"gpt-6-sol",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "Reasoning effort" }),
			"ultra",
		);
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "codex Model" }),
			"gpt-6-luna",
		);
		await expect(backend.getByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "ハンドオフ設定を保存" }),
		).toBeDisabled();
		await userEvent.selectOptions(
			backend.getByRole("combobox", { name: "Reasoning effort" }),
			"high",
		);
		await expect(backend.queryByRole("alert")).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ設定を保存" }),
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
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6.1 Sol Medium");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.click(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
		);
		await expect(
			page.getByRole("option", { name: "on-request" }),
		).toHaveAttribute("aria-selected", "true");
		await expect(
			page.queryByRole("option", { name: "未指定" }),
		).not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
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
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).toBeInTheDocument();
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.click(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
		);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("option", {
				name: "granular",
			}),
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
		await expect(
			canvas.getByRole("button", { name: "高度な設定" }),
		).toHaveAttribute("aria-expanded", "true");
		await expect(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
		).toBeVisible();
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
			await userEvent.click(policy);
			await userEvent.click(page.getByRole("option", { name: value }));
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
export const SliderCards: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const screen = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await canvas.findByRole("button", { name: "高度な設定" }),
		);
		const model = canvas.getByRole("button", {
			name: "モデルと推論レベル",
		});
		const permissions = canvas.getByRole("button", {
			name: "サンドボックスモード",
		});
		await Promise.all(
			canvasElement
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished),
		);
		model.scrollIntoView({ block: "start" });
		const document = canvasElement.ownerDocument;
		const scrollTop = document.documentElement.scrollTop;
		await expect(scrollTop).toBeGreaterThan(0);

		await userEvent.click(model);
		await expect(
			screen.getByRole("slider", { name: "推論" }),
		).toHaveFocus();
		await expect(document.documentElement.scrollTop).toBe(scrollTop);
		await userEvent.click(permissions);
		await expect(model).toHaveAttribute("aria-expanded", "false");
		await expect(permissions).toHaveAttribute("aria-expanded", "true");
		await expect(
			screen.getByRole("slider", { name: "サンドボックスモード" }),
		).toHaveFocus();
		await expect(document.documentElement.scrollTop).toBe(scrollTop);

		await userEvent.click(model);
		await expect(permissions).toHaveAttribute("aria-expanded", "false");
		await expect(model).toHaveAttribute("aria-expanded", "true");
		await expect(
			screen.getByRole("slider", { name: "推論" }),
		).toHaveFocus();
		await expect(document.documentElement.scrollTop).toBe(scrollTop);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(model).toHaveFocus());
		await expect(document.documentElement.scrollTop).toBe(scrollTop);
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
		await userEvent.type(timeout, "1.5");
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ設定を保存" }),
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
