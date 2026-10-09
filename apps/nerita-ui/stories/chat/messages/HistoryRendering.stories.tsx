// 長文履歴を表示したまま入力と応答を更新し、過去の本文・リンクの操作状態を保つ。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ChatMessage } from "@nerita/shared/chatState";
import { StoryChat, storyBridge } from "../StoryChat";
import { createChatStoryBridge } from "../mocks/mockBridge";

/** 個人の会話内容を含めず、実際に遅延が起きた履歴と同程度の本文量を用意する。 */
const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => [
	{
		id: `user-${index}`,
		role: "user" as const,
		text: `確認対象 ${index}\n\n${"本文と **設定** を確認してください。\n".repeat(800)}`,
	},
	{
		id: `assistant-${index}`,
		role: "assistant" as const,
		text: `確認結果 ${index}。詳細は [資料 ${index}](https://example.test/details/${index}) を参照してください。`,
	},
]).flat();

/** 本文量だけを固定し、入力・Markdown・差分購読は製品の実装を使う。 */
function HistoryRendering() {
	const bridge = useMemo(() => {
		const bridge = createChatStoryBridge();
		bridge.patchState({ messages });
		return bridge;
	}, []);
	return <StoryChat bridge={bridge} />;
}

const meta = {
	title: "Chat/History Rendering",
	component: HistoryRendering,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HistoryRendering>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 過去のリンクを読む操作を、新しい回答の到着で失わないことを確認する。 */
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

/** 高速入力と長押し相当の連続削除でも、古い下書きの反映で編集結果を上書きしない。 */
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

/** Host から復元した下書きは編集でき、送信が受理されるまで消さない。 */
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

/** DLC へ切り替えて入力欄を隠した後も、下書きを保持して通常チャットへ戻す。 */
export const ModeSwitchKeepsDraft: Story = {
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
			environment: null,
			selected: null,
			error: null,
			active: null,
			execution: null,
		};
		bridge.emit({ type: "dlc/state", view });
		await waitFor(() =>
			expect(canvas.queryByRole("textbox")).not.toBeInTheDocument(),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
		bridge.emit({ type: "dlc/state", view: { ...view, mode: "chat" } });
		await waitFor(() =>
			expect(canvas.getByRole("textbox")).toHaveTextContent(
				"編集中の下書き",
			),
		);
	},
};
