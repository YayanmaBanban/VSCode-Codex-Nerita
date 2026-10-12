// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyBridge } from "../storyBridgeElement";
import { messages } from "./HistoryRenderingData";
import HistoryRenderingHistoryRendering from "./HistoryRenderingHistoryRendering.svelte";
const meta = {
	title: "Chat/History Rendering",
	component: HistoryRenderingHistoryRendering,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HistoryRenderingHistoryRendering>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const LongHistory: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox");
		await userEvent.type(input, "履歴を開いたまま入力", { delay: 20 });
		await expect(input).toHaveTextContent("履歴を開いたまま入力");

		const link = canvas.getByRole("link", { name: "資料 7" });
		link.focus();
		await expect(link).toHaveFocus();
		bridge.patchState({
			messages: [
				...messages,
				{
					id: "new-answer",
					role: "assistant",
					text: "新しい回答です。",
				},
			],
		});
		await waitFor(() =>
			expect(canvas.getByText("新しい回答です。")).toBeVisible(),
		);
		await expect(link).toHaveFocus();
		await expect(input).toHaveTextContent("履歴を開いたまま入力");
	},
};
export const RapidEditing: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox");
		await userEvent.type(input, "履歴を開いたまま入力");
		await expect(input).toHaveTextContent("履歴を開いたまま入力");
		await userEvent.keyboard("{Backspace>8/}");
		await expect(input).toHaveTextContent("履歴");
		await expect(
			bridge.sent
				.filter((message) => message.type === "ui/saveDraft")
				.at(-1),
		).toEqual(expect.objectContaining({ draft: "履歴" }));
	},
};
export const RestoredDraftSubmission: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox");
		bridge.emit({
			type: "ui/viewState",
			editor: false,
			draft: "復元した下書き",
			scrollTop: 0,
			restoreScroll: false,
		});
		await waitFor(() => expect(input).toHaveTextContent("復元した下書き"));
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		const request = bridge.sent.find(
			(message) => message.type === "prompt/send",
		);
		await expect(request).toEqual(
			expect.objectContaining({ text: "復元した下書き" }),
		);
		if (request?.type !== "prompt/send") {
			throw new Error("送信要求がありません");
		}
		await expect(input).toHaveTextContent("復元した下書き");
		await expect(input).toHaveAttribute("aria-disabled", "true");
		bridge.emit({
			type: "prompt/accepted",
			requestId: request.requestId,
			mode: "start",
		});
		await waitFor(() => expect(input.textContent).toBe(""));
		await expect(input).toHaveAttribute("aria-disabled", "false");
		await expect(
			bridge.sent
				.filter((message) => message.type === "ui/saveDraft")
				.at(-1),
		).toEqual(expect.objectContaining({ draft: "" }));
	},
};
export const DlcWorkspaceKeepsDraft: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.type(canvas.getByRole("textbox"), "編集中の下書き");
		await userEvent.click(canvas.getByRole("button", { name: "DLC" }));
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({ type: "dlc/open" }),
		);
		const view = {
			mode: "dlc" as const,
			backend: "codex" as const,
			intents: [],
			targets: [],
			targetId: null,
			targetBusy: false,
			assignmentPending: false,
			running: [],
			environment: null,
			selected: null,
			error: null,
			active: null,
			execution: null,
		};
		bridge.emit({ type: "dlc/state", view });
		await expect(canvas.getByRole("textbox")).toBeVisible();
		await waitFor(() =>
			expect(canvas.getByRole("textbox")).toHaveTextContent(
				"編集中の下書き",
			),
		);
	},
};
