import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SymbolStory from "./SymbolStory.svelte";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { storyBridge } from "../storyBridgeElement";
import { mockWorkspaceSymbols } from "../mocks/mockWorkspaceSymbols";

const meta = {
	title: "Chat/Composer Symbols",
	component: SymbolStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SymbolStory>;

export default meta;

/** 検索から挿入・送信まで操作できるストーリー。 */
type Story = StoryObj<typeof meta>;

export const Search: Story = {
	play: async (context) => openSymbols(context.canvasElement, "UserService"),
};

/** Host の応答を保留し、検索中の状態を表示する。 */
export const Loading: Story = {
	args: { pending: true },
	play: async ({ canvasElement }) => {
		await openSymbols(canvasElement, "UserService", false);
		await expect(
			within(canvasElement).getByRole("listbox", { name: "シンボル" }),
		).toHaveTextContent("検索中");
		await expect(
			within(canvasElement).getByRole("listbox", { name: "シンボル" }),
		).toHaveAttribute("aria-busy", "true");
	},
};

/** 応答を受信するまで検索中の表示を保ち、受信後は読み込み中のアイコンを外して候補へ切り替える。 */
export const LoadingThenResults: Story = {
	args: { pending: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await openSymbols(canvasElement, "UserService", false);
		const list = canvas.getByRole("listbox", { name: "シンボル" });
		await expect(list).toHaveAttribute("aria-busy", "true");
		await waitFor(() =>
			expect(bridge.sent).toContainEqual(
				expect.objectContaining({
					type: "workspace/searchSymbols",
					query: "UserService",
				}),
			),
		);
		const request = bridge.sent.find(
			(message) =>
				message.type === "workspace/searchSymbols" &&
				message.query === "UserService",
		);
		if (request?.type !== "workspace/searchSymbols") {
			throw new Error("検索要求が送信されていません。");
		}
		bridge.emit(mockWorkspaceSymbols(request));
		await waitFor(() => expect(list).toHaveAttribute("aria-busy", "false"));
		await expect(list).toHaveTextContent("UserService");
	},
};

/** シンボル位置をチップの表示だけで終わらせず、送信のコード参照へ引き継ぐ。 */
export const SendDefinition: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await openSymbols(canvasElement, "UserService");
		const entries = await canvas.findAllByRole("option", {
			name: /UserService/,
		});
		await userEvent.click(entries[0]!);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		const prompt = storyBridge(canvasElement).sent.find(
			(message) => message.type === "prompt/send",
		);
		if (prompt?.type !== "prompt/send") {
			throw new Error("シンボル参照が送信されていません。");
		}
		await expect(prompt.codeReferences?.[0]?.uri).toContain(
			"services/UserService.ts",
		);
		await expect(prompt.codeReferences?.[0]?.range).toEqual({
			start: { line: 41, character: 0 },
			end: { line: 137, character: 1 },
		});
	},
};
export const NoResults: Story = {
	play: async (context) =>
		openSymbols(context.canvasElement, "missing-symbol"),
};
export const SearchError: Story = {
	play: async ({ canvasElement }) => {
		await openSymbols(canvasElement, "error");
		await waitFor(() =>
			expect(
				within(canvasElement).getByRole("listbox", {
					name: "シンボル",
				}),
			).toBeVisible(),
		);
	},
};

/** Host 全体からの失敗通知でも検索を完了し、タイムアウトまで待たせない。 */
export const SearchRequestFailure: Story = {
	play: async ({ canvasElement }) => {
		await openSymbols(canvasElement, "failed-request");
		await expect(
			within(canvasElement).getByRole("listbox", { name: "シンボル" }),
		).toHaveTextContent("Host search failed");
	},
};

/** 候補を選択せず、検索結果や Host のエラーをパネル内に残す。 */
async function openSymbols(
	canvasElement: HTMLElement,
	query: string,
	waitForReply = true,
) {
	const canvas = within(canvasElement);
	await userEvent.click(
		canvas.getByRole("button", { name: "コンテキストを追加" }),
	);
	await userEvent.click(
		await canvas.findByRole("option", { name: "シンボル" }),
	);
	await userEvent.type(
		canvas.getByRole("combobox", { name: "シンボルを検索" }),
		query,
	);
	if (!waitForReply) {
		return;
	}
	await waitFor(() =>
		expect(
			JSON.parse(canvas.getByLabelText("検索完了").textContent),
		).toContain(query),
	);
}
