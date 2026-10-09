// 大量の会話で表示範囲・画面外検索・カードの開閉保持を確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { StoryChat } from "./StoryChat";
import { createChatStoryBridge } from "./mocks/mockBridge";
import { virtualizationData } from "./fixtures/virtualization";
import type { StoryBridge } from "./mocks/storyBridge";
import { scenarioState } from "./fixtures/chatState";

/** 実コンポーネントへ長い会話を渡し、通信境界で追加応答を再現する。 */
function VirtualizationStory({ updates = false }: { updates?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			...virtualizationData(),
			sessionId: "virtual-session",
		});
		return mock;
	}, []);
	return (
		<>
			{updates && <UpdateControls bridge={bridge} />}
			<StoryChat bridge={bridge} />
		</>
	);
}

/** Host からの追加応答・承認・保存位置の復元通知を明示的に注入する。 */
function UpdateControls({ bridge }: { bridge: StoryBridge }) {
	return (
		<div className="fixed top-12 right-2 z-50 flex gap-2 rounded bg-secondary p-1">
			<button
				onClick={() =>
					bridge.patchState({
						messages: [
							...virtualizationData().messages,
							{
								id: "appended",
								order: 400,
								role: "assistant",
								text: "新着の応答",
							},
						],
						run: "running",
					})
				}
			>
				応答を受信
			</button>
			<button
				onClick={() =>
					bridge.patchState({
						permissions: scenarioState("permission").permissions,
					})
				}
			>
				承認を受信
			</button>
			<button
				onClick={() => {
					const saved = [...bridge.sent]
						.reverse()
						.find((message) => message.type === "ui/saveScroll");
					if (saved?.type === "ui/saveScroll") {
						bridge.emit({
							type: "ui/viewState",
							editor: true,
							draft: "",
							restoreScroll: true,
							scrollTop: saved.scrollTop,
							...(saved.scrollAnchor
								? { scrollAnchor: saved.scrollAnchor }
								: {}),
						});
					}
				}}
			>
				復元通知を受信
			</button>
		</div>
	);
}
const meta = {
	title: "Chat/Virtualization",
	component: VirtualizationStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof VirtualizationStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LongHistory: Story = {};
export const Updates: Story = { args: { updates: true } };

/** 保存した表示位置へ戻り、新着で過去の閲覧を動かさず承認には末尾から操作できる。 */
export const RestoreAndAppend: Story = {
	args: { updates: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await waitFor(() =>
			expect(canvas.getByText("末尾の検索対象")).toBeVisible(),
		);
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "f",
				ctrlKey: true,
				bubbles: true,
			}),
		);
		const input = await canvas.findByRole("textbox", {
			name: "会話を検索",
		});
		await userEvent.type(input, "履歴 80:");
		await waitFor(() =>
			expect(canvas.getByLabelText("検索結果")).toHaveTextContent("1/1"),
		);
		await userEvent.keyboard("{Escape}");
		const row = () =>
			conversation.querySelector<HTMLElement>(
				'[data-entry-key="message:virtual-message-80"]',
			);
		await waitFor(() => expect(row()).toBeVisible());
		const offset =
			row()!.getBoundingClientRect().top -
			conversation.getBoundingClientRect().top;
		await userEvent.click(
			canvas.getByRole("button", { name: "エディタグループへ移動" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() => expect(row()).not.toBeInTheDocument());
		await userEvent.click(
			canvas.getByRole("button", { name: "復元通知を受信" }),
		);
		await waitFor(() => expect(row()).toBeVisible());
		await waitFor(() =>
			expect(
				Math.abs(
					row()!.getBoundingClientRect().top -
						conversation.getBoundingClientRect().top -
						offset,
				),
			).toBeLessThan(2),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "応答を受信" }),
		);
		await waitFor(() =>
			expect(
				conversation.querySelector("[data-entry-count]"),
			).toHaveAttribute("data-entry-count", "401"),
		);
		await expect(row()).toBeVisible();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() =>
			expect(canvas.getByText("新着の応答")).toBeVisible(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "承認を受信" }),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "今回のみ許可" }),
			).toBeVisible(),
		);
	},
};

/** 全会話を描画せず検索し、画面外へ出たカードを開いたまま再表示する。 */
export const SearchAndExpansion: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", {
			name: /^会話$/,
		});
		await waitFor(() =>
			expect(canvas.getByText("末尾の検索対象")).toBeVisible(),
		);
		await expect(
			canvas.queryByText("先頭の検索対象"),
		).not.toBeInTheDocument();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "f",
				ctrlKey: true,
				bubbles: true,
			}),
		);
		const input = await canvas.findByRole("textbox", {
			name: "会話を検索",
		});
		await userEvent.type(input, "折り畳み検索対象");
		await waitFor(() =>
			expect(canvas.getByText(/折り畳み検索対象/)).toBeVisible(),
		);
		const heading = canvas.getByRole("button", {
			name: /^冒頭ツール/,
			expanded: true,
		});
		await expect(heading).toBeVisible();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", { name: /^冒頭ツール/ }),
			).not.toBeInTheDocument(),
		);
		conversation.scrollTop = 0;
		conversation.dispatchEvent(new Event("scroll"));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", {
					name: /^冒頭ツール/,
					expanded: true,
				}),
			).toBeVisible(),
		);
		await expect(canvas.getByText(/折り畳み検索対象/)).toBeVisible();
	},
};
