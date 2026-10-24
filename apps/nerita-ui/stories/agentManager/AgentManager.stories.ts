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
		const footer = within(canvasElement.querySelector("footer")!);
		await expect(footer.getAllByRole("alert")).toHaveLength(2);
		await expect(footer.queryByRole("status")).not.toBeInTheDocument();
		await expect(footer.getAllByRole("button")).toHaveLength(1);
		await expect(
			footer.getByRole("button", { name: "再読み込み" }),
		).toBeEnabled();
		await expect(
			within(canvasElement).getByRole("textbox", { name: "名前" }),
		).toBeDisabled();
	},
};
export const InitializationError: Story = {
	args: { mode: "initialization-error" },
	play: async ({ canvasElement }) => {
		const alert = await within(canvasElement).findByRole("alert");
		await waitFor(() => expect(alert).toBeVisible());
	},
};
export const InitializationRecovery: Story = {
	args: { mode: "initialization-error" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const footer = within(canvasElement.querySelector("footer")!);
		await waitFor(() => expect(footer.getByRole("alert")).toBeVisible());
		await expect(
			footer.queryByRole("button", { name: "変更を保存" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			footer.getByRole("button", { name: "再読み込み" }),
		);
		await expect(
			await canvas.findByRole("textbox", { name: "名前" }),
		).toBeVisible();
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(
			args.onRequest.mock.calls.filter(
				([request]) => request.type === "reload",
			),
		).toHaveLength(1);
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
		const alert = await canvas.findByRole("alert");
		await waitFor(() => expect(alert).toBeVisible());
		await expect(
			canvasElement.querySelector("footer .lucide-circle-alert"),
		).toBeInTheDocument();
	},
};

export const ReloadAfterConflict: Story = {
	args: { mode: "conflict" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "writer-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const footer = within(canvasElement.querySelector("footer")!);
		const alert = await footer.findByRole("alert");
		await waitFor(() => expect(alert).toBeVisible());
		await expect(footer.getAllByRole("button")).toHaveLength(1);
		await expect(name).toBeDisabled();
		await expect(canvas.getByRole("searchbox")).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: "新しいエージェントを追加" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: "reviewer" }),
		).toBeDisabled();
		await expect(
			within(canvasElement.querySelector("header")!).getByRole("button", {
				name: "再読み込み",
			}),
		).toBeEnabled();
		await userEvent.click(
			footer.getByRole("button", { name: "再読み込み" }),
		);
		await waitFor(() =>
			expect(
				args.onRequest.mock.calls.filter(
					([request]) => request.type === "reload",
				),
			).toHaveLength(1),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"writer",
		);
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("textbox", { name: "名前" }),
		).toBeEnabled();
		await expect(canvas.getByRole("searchbox")).toBeEnabled();
		await expect(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		).toBeEnabled();
	},
};
export const HeaderReloadAfterConflict: Story = {
	args: { mode: "conflict" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "writer-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const alert = await canvas.findByRole("alert");
		await waitFor(() => expect(alert).toBeVisible());
		await userEvent.click(
			within(canvasElement.querySelector("header")!).getByRole("button", {
				name: "再読み込み",
			}),
		);
		await waitFor(() =>
			expect(
				args.onRequest.mock.calls.filter(
					([request]) => request.type === "reload",
				),
			).toHaveLength(1),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"writer",
		);
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
	},
};
export const ReloadFailureKeepsLocked: Story = {
	args: { mode: "reload-failure" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.type(name, "-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const footer = within(canvasElement.querySelector("footer")!);
		await waitFor(() => expect(footer.getByRole("alert")).toBeVisible());
		await userEvent.click(
			footer.getByRole("button", { name: "再読み込み" }),
		);
		await waitFor(() =>
			expect(
				footer.getByRole("button", { name: "再読み込み" }),
			).toBeEnabled(),
		);
		await expect(footer.getByRole("alert")).toBeVisible();
		await expect(footer.getAllByRole("button")).toHaveLength(1);
		await expect(name).toBeDisabled();
		await expect(name).toHaveValue("writer-draft");
		await expect(canvas.getByRole("searchbox")).toBeDisabled();
	},
};
export const EditableAfterValidationError: Story = {
	args: { mode: "validation-error" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.type(name, "-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
		await expect(name).toBeEnabled();
		await userEvent.type(name, "-corrected");
		await expect(name).toHaveValue("writer-draft-corrected");
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
		await expect(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		).toBeEnabled();
	},
};
export const DuplicateNameBeforeSave: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "reviewer");
		await userEvent.tab();
		await expect(name).toHaveAttribute("aria-invalid", "true");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await expect(
			args.onRequest.mock.calls.filter(
				([request]) => request.type === "agent",
			),
		).toHaveLength(0);
		await userEvent.clear(name);
		await userEvent.type(name, "writer");
		await userEvent.tab();
		await expect(name).not.toHaveAttribute("aria-invalid");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
		await userEvent.clear(name);
		await userEvent.type(name, "codex-reviewer");
		await userEvent.tab();
		await expect(name).not.toHaveAttribute("aria-invalid");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
	},
};
export const ExistingFilenameBeforeSave: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: "新しいエージェントを追加",
			}),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"new-reviewer",
		);
		const filename = canvas.getByRole("textbox", { name: "ファイル名" });
		await userEvent.type(filename, "REVIEWER");
		await userEvent.tab();
		await expect(filename).toHaveAttribute("aria-invalid", "true");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await expect(
			args.onRequest.mock.calls.filter(
				([request]) => request.type === "createAgent",
			),
		).toHaveLength(0);
		await userEvent.clear(filename);
		await userEvent.type(filename, "new-reviewer");
		await userEvent.tab();
		await expect(filename).not.toHaveAttribute("aria-invalid");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
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
		await userEvent.click(
			backend.getByRole("combobox", { name: "モデル選択のモード" }),
		);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("option", {
				name: "モデルを固定する",
			}),
		);
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			backend.getByRole("combobox", { name: "モデル" }),
		);
		await userEvent.click(page.getByRole("option", { name: "GPT-6 Sol" }));
		await userEvent.click(
			backend.getByRole("combobox", { name: "推論レベル" }),
		);
		await userEvent.click(page.getByRole("option", { name: "Ultra" }));
		await userEvent.click(
			backend.getByRole("combobox", { name: "モデル" }),
		);
		await userEvent.click(page.getByRole("option", { name: "GPT-6 Luna" }));
		await expect(backend.getByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await userEvent.click(
			backend.getByRole("combobox", { name: "推論レベル" }),
		);
		await userEvent.click(page.getByRole("option", { name: "High" }));
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
		const page = within(canvasElement.ownerDocument.body);
		help.focus();
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		const timeout = canvas.getByRole("spinbutton", {
			name: "タイムアウト（秒）",
		});
		await expect(timeout).toHaveValue(120);
		await userEvent.click(canvas.getByText("実行設定", { exact: true }));
		await expect(timeout).not.toBeVisible();
		await userEvent.click(canvas.getByText("実行設定", { exact: true }));
		await expect(timeout).toBeVisible();
		await userEvent.hover(help);
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
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
		).not.toBeInTheDocument();
		await expect(
			canvasElement.querySelector("footer .lucide-circle-alert"),
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
