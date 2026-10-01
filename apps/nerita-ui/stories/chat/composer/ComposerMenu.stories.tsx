// 添付とスキルを持つチャットで、候補選択と送信する本文を確認する。
import { useMemo, useState } from "react";
import type { UiMessage } from "@nerita/shared/messages";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { StoryChat as ChatApp, storyBridge } from "../StoryChat";
import { scenarioState } from "../fixtures/chatState";
import { createChatStoryBridge } from "../mocks/mockBridge";

/** 実接続を使わず、Host が渡す一覧を再現する。 */
function ComposerMenuStory() {
	const [sent, setSent] = useState("");
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			attachments: [
				{
					id: "a",
					name: "alpha.ts",
					uri: "file:///D:/workspace/alpha.ts",
				},
				{
					id: "b",
					name: "日本語 sample.md",
					uri: "file:///D:/workspace/sample.md",
				},
			],
			skills: [
				{
					name: "review",
					description: "コードを確認する",
					path: "D:/skills/review/SKILL.md",
				},
				{
					name: "test",
					description: "テストを実行する",
					path: "D:/skills/test/SKILL.md",
				},
			],
		});
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message: UiMessage) {
				if (message.type === "prompt/send") {
					setSent(message.text);
				}
				mock.postMessage(message);
			},
		};
	}, []);
	return (
		<>
			<ChatApp bridge={bridge} />
			<output hidden aria-label="送信した本文">
				{sent}
			</output>
		</>
	);
}
const meta = {
	title: "Chat/Composer Menu",
	component: ComposerMenuStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ComposerMenuStory>;
export default meta;
/** 入力候補を操作できるストーリー。 */
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await userEvent.click(input);
		await userEvent.type(input, "/");
		await expect(
			await canvas.findByRole("option", { name: /\/plan/ }),
		).toBeVisible();
		await expect(
			canvas.getByRole("option", { name: /\/goal/ }),
		).toBeVisible();
		// Host から Pi の状態が届いたとき、開いた候補にも切替を反映する。
		const state = scenarioState("empty");
		state.revision = 100;
		state.uiContributions = { surface: "pi", items: [] };
		bridge.emit({ type: "state/snapshot", state });
		bridge.emit({ type: "ui/backendState", backend: "pi" });
		await waitFor(async () => {
			await expect(
				canvas.queryByRole("option", { name: /\/plan/ }),
			).not.toBeInTheDocument();
			await expect(
				canvas.queryByRole("option", { name: /\/goal/ }),
			).not.toBeInTheDocument();
		});
		await userEvent.clear(input);
		await userEvent.type(input, "/");
		await userEvent.click(
			await canvas.findByRole("option", { name: /\/new/ }),
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({ type: "prompt/send", text: "/new" }),
		);
	},
};
