// 接続・会話・承認・障害状態を、本体の Svelte UI で検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import ChatStory from "./ChatStory.svelte";
import { storyBridge } from "./storyBridgeElement";

const meta = {
	title: "Chat/App",
	component: ChatStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "empty", approvalTool: "write", piRun: "idle" },
} satisfies Meta<typeof ChatStory>;
export default meta;
/** チャット画面のストーリー定義。 */
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};

/** 貼り付けたコードをフェンス付きで送り、Host から戻ったユーザー本文をコードとして描画する。 */
export const PastedCodeMessage: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = await canvas.findByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const code =
			"function example() {\n  const marker = '```';\n  return marker;\n}\n// end";
		await userEvent.click(input);
		await userEvent.type(input, "次のコードを確認してください。");
		await userEvent.paste(code);
		await waitFor(() =>
			expect(
				canvas.getByLabelText("貼り付けコードブロック").innerText,
			).toContain(code),
		);
		await userEvent.keyboard("後文も保持します。");
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		const sent = bridge.sent.find(
			(message) => message.type === "prompt/send",
		);
		if (sent?.type !== "prompt/send") {
			throw new globalThis.Error("送信要求がありません。");
		}
		await expect(sent.text).toBe(
			"次のコードを確認してください。\n````\nfunction example() {\n  const marker = '```';\n  return marker;\n}\n// end\n````\n後文も保持します。",
		);
		bridge.patchState({
			messages: [
				{
					id: "pasted-code-message",
					role: "user",
					text: sent.text,
					...(sent.references ? { references: sent.references } : {}),
				},
			],
		});
		bridge.emit({
			type: "prompt/accepted",
			requestId: sent.requestId,
			mode: "start",
		});
		await waitFor(() =>
			expect(
				canvasElement.querySelector(".message.user pre code")
					?.textContent,
			).toContain(code),
		);
		await expect(
			canvas.getByText("後文も保持します。", { exact: true }),
		).toBeVisible();
		await expect(input).toHaveTextContent("");
	},
};

/** フェンス追加で送信上限を超える場合は、本文を送らず編集可能な下書きを残す。 */
export const PastedCodeLimit: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = await canvas.findByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await userEvent.click(input);
		await userEvent.paste(`${"x".repeat(99_987)}\na\nb\nc\nd`);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await expect(
			await canvas.findByText("本文は100,000文字以内にしてください。"),
		).toBeVisible();
		await expect(
			bridge.sent.filter((message) => message.type === "prompt/send"),
		).toHaveLength(0);
		await expect(input).toHaveAttribute("contenteditable", "true");
		await expect(
			canvas.getByLabelText("貼り付けコードブロック").innerText,
		).toContain("\na\nb\nc\nd");
	},
};

/** 設定カードの切り替えと自動フォーカスで、別の説明が操作を遮らないことを確認する。 */
export const SettingsPopups: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const screen = within(canvasElement.ownerDocument.body);
		const model = await canvas.findByRole("button", {
			name: "モデルと推論レベル",
		});
		const mode = canvas.getByRole("button", { name: "Mode" });
		const collaboration = canvas.getByRole("combobox", {
			name: "Collaboration mode",
		});

		await userEvent.click(model);
		await expect(
			screen.getByRole("slider", { name: "Reasoning effort" }),
		).toHaveFocus();
		// 表示待ち時間を過ぎても、先頭ボタンの自動フォーカスによる説明を出さない。
		await new Promise((resolve) => setTimeout(resolve, 600));
		await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		const fastMode = screen.getByRole("switch", { name: "ファストモード" });
		await userEvent.hover(fastMode);
		await expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"ファストモード",
		);
		await userEvent.unhover(fastMode);
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);

		await userEvent.click(screen.getByRole("combobox", { name: "Model" }));
		await expect(
			screen.getByRole("listbox", { name: "Model" }),
		).toBeVisible();
		await expect(model).toHaveAttribute("aria-expanded", "true");
		await userEvent.keyboard("{Escape}");
		await expect(model).toHaveAttribute("aria-expanded", "true");

		await userEvent.click(mode);
		await expect(
			screen.getByRole("slider", { name: "Mode" }),
		).toHaveFocus();
		await expect(model).toHaveAttribute("aria-expanded", "false");
		await new Promise((resolve) => setTimeout(resolve, 600));
		await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("combobox", { name: "ApprovalsReviewer" }),
		);
		await expect(
			screen.getByRole("listbox", { name: "ApprovalsReviewer" }),
		).toBeVisible();
		await expect(mode).toHaveAttribute("aria-expanded", "true");
		await userEvent.keyboard("{Escape}");
		await expect(mode).toHaveAttribute("aria-expanded", "true");

		// 設定カードと選択欄を相互に切り替えても、開いているポップアップを1つに保つ。
		for (const target of [
			collaboration,
			model,
			collaboration,
			mode,
			model,
			mode,
		]) {
			await userEvent.click(target);
			await waitFor(async () => {
				for (const trigger of [model, mode, collaboration]) {
					await expect(trigger).toHaveAttribute(
						"aria-expanded",
						trigger === target ? "true" : "false",
					);
				}
			});
		}

		await userEvent.click(mode);
		await new Promise((resolve) => setTimeout(resolve, 600));
		await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		await userEvent.click(model);
		await expect(
			screen.getByRole("slider", { name: "Reasoning effort" }),
		).toBeVisible();
		await userEvent.click(model);
		await userEvent.unhover(model);
	},
};
export const Pi: Story = { args: { pi: true } };
export const PiTools: Story = { args: { piTools: true, piRun: "completed" } };
export const PiNestedTools: Story = {
	args: { piNestedTools: true, piRun: "running" },
};
export const PiNestedHistory: Story = {
	args: { piNestedTools: true, piRun: "completed" },
};
export const PiApprovals: Story = { args: { piApprovals: true } };
export const PiHistory: Story = { args: { piHistory: true } };
export const AppServer: Story = { args: { appServer: true } };
export const AppServerStreaming: Story = {
	args: { scenario: "streaming", appServer: true },
};
export const AppServerPermission: Story = {
	args: { scenario: "permission", appServer: true },
};
export const Connecting: Story = { args: { scenario: "connecting" } };
export const Authentication: Story = { args: { scenario: "auth" } };
export const Streaming: Story = { args: { scenario: "streaming" } };
export const Completed: Story = { args: { scenario: "completed" } };
export const Permission: Story = { args: { scenario: "permission" } };
export const Cancelled: Story = { args: { scenario: "cancelled" } };
export const Cancelling: Story = { args: { scenario: "cancelling" } };
export const Failed: Story = { args: { scenario: "failed" } };
export const Error: Story = { args: { scenario: "error" } };

export const PiStreaming: Story = { args: { pi: true, piRun: "running" } };
export const PiCompleted: Story = { args: { pi: true, piRun: "completed" } };
export const PiCancelled: Story = { args: { pi: true, piRun: "cancelled" } };

/** 承認要求の ID を保ち、Host 応答が届くまで表示状態を確定しない。 */
export const ApprovalRequest: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("今回のみ許可", "accept"),
};

/** カーテン付きの拒否ボタンから、拒否に対応する選択肢 ID を送信する。 */
export const ApprovalDeclined: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("拒否", "decline"),
};
/** カーテン付きの中止ボタンから、ターン中止に対応する選択肢 ID を送信する。 */
export const ApprovalCancelled: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("ターンを中止", "cancel"),
};

/** 要求と選択肢の ID を送信し、Host の応答まで承認カードが残ることを確認する。 */
function approvalPlay(
	name: string,
	optionId: string,
): NonNullable<Story["play"]> {
	return async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(await canvas.findByRole("button", { name }));
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({
				type: "permission/respond",
				permissionId: "permission",
				optionId,
				sessionId: "story-session",
				runId: "story-run",
			}),
		);
		await expect(
			canvas.getByRole("region", { name: "承認要求" }),
		).toBeVisible();
		bridge.patchState({ permissions: [], run: "completed" });
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "承認要求" }),
			).not.toBeInTheDocument(),
		);
	};
}
