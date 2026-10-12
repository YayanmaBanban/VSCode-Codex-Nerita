import type { Meta, StoryObj } from "@storybook/svelte-vite";
import ComposerMenuStory from "./ComposerMenuStory.svelte";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { storyBridge } from "../storyBridgeElement";
import { scenarioState } from "../fixtures/chatState";

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
			canvas.queryByRole("option", { name: /\/goal/ }),
		).not.toBeInTheDocument();
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

export const KeyboardSelection: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		for (const key of ["[Enter]", " "]) {
			await userEvent.click(input);
			await userEvent.clear(input);
			await userEvent.type(input, "/");
			const option = await canvas.findByRole("option", { name: /\/new/ });
			option.focus();
			await expect(option).toHaveFocus();
			await userEvent.keyboard(key);
			await expect(input).toHaveTextContent("/new");
			await expect(bridge.sent).not.toContainEqual(
				expect.objectContaining({ type: "prompt/send" }),
			);
		}
	},
};

/** 合成されたIMEキーを送信にせず、通常の改行と明示的な送信を保つ。 */
export const CompositionAndLineBreaks: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await userEvent.click(input);
		await userEvent.type(input, "alpha");
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				ctrlKey: true,
				isComposing: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		await expect(
			bridge.sent.filter((message) => message.type === "prompt/send"),
		).toHaveLength(0);
		await userEvent.keyboard("[Enter]");
		await userEvent.keyboard("beta");
		await userEvent.keyboard("{Shift>}[Enter]{/Shift}");
		await userEvent.keyboard("end");
		await waitFor(() =>
			expect(bridge.sent).toContainEqual(
				expect.objectContaining({
					type: "ui/saveDraft",
					draft: "alpha\nbeta\nend",
				}),
			),
		);
		await userEvent.keyboard("{Control>}[Enter]{/Control}");
		await waitFor(() =>
			expect(
				bridge.sent.filter((message) => message.type === "prompt/send"),
			).toHaveLength(1),
		);
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({
				type: "prompt/send",
				text: "alpha\nbeta\nend",
			}),
		);
	},
};
