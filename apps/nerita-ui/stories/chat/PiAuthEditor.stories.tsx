// Host の固定 DTO と送信記録を使い、認証の完了をストーリー内では導出しない。
import type { PiAuthState } from "@nerita/shared/piAuth";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, expect, userEvent, within } from "storybook/test";
import { PiAuthEditor } from "../../src/pi/PiAuthEditor";

const authInitialState: PiAuthState = {
	items: [
		{
			id: "anthropic",
			name: "Anthropic",
			configured: true,
			methods: [
				{ id: "anthropic-key", name: "APIキーを設定" },
				{ id: "anthropic-oauth", name: "OAuthでログイン" },
			],
		},
		{
			id: "openai",
			name: "OpenAI",
			configured: false,
			methods: [
				{ id: "openai-key", name: "APIキーを設定" },
				{ id: "openai-oauth", name: "OAuthでログイン" },
			],
		},
		{
			id: "google",
			name: "Google",
			configured: false,
			methods: [{ id: "google-key", name: "APIキーを設定" }],
		},
	],
	active: null,
	prompt: null,
	notice: "",
	error: null,
};

const meta = {
	title: "Chat/PiAuthEditor",
	component: PiAuthEditor,
	parameters: { layout: "fullscreen" },
	args: { state: authInitialState, send: fn() },
} satisfies Meta<typeof PiAuthEditor>;
export default meta;
/** 通信結果ごとに明示的な表示状態を指定する。 */
type Story = StoryObj<typeof meta>;
export const Providers: Story = {};
export const InputPending: Story = {
	args: {
		state: {
			...authInitialState,
			active: "openai-key",
			prompt: {
				id: "openai-key",
				message: "APIキーを入力してください",
				secret: true,
			},
		},
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByPlaceholderText("APIキーを入力してください"),
			"fixture-key",
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await expect(args.send).toHaveBeenLastCalledWith({
			type: "answer",
			id: "openai-key",
			value: "fixture-key",
		});
		await expect(
			canvas.getByPlaceholderText("APIキーを入力してください"),
		).toHaveValue("");
	},
};
export const OAuthPending: Story = {
	args: {
		state: {
			...authInitialState,
			active: "openai-oauth",
			prompt: {
				id: "openai-oauth",
				message: "確認コードを入力してください",
				secret: true,
			},
			feedback: {
				openai: {
					notice: "ブラウザで認証を完了してください。",
					error: null,
				},
			},
		},
	},
};
export const Configured: Story = {
	args: {
		state: {
			...authInitialState,
			items: [
				authInitialState.items[0]!,
				{ ...authInitialState.items[1]!, configured: true },
				authInitialState.items[2]!,
			],
			feedback: {
				openai: { notice: "認証情報を更新しました。", error: null },
			},
		},
	},
};
export const Cancelled: Story = {
	args: {
		state: {
			...authInitialState,
			feedback: {
				openai: { notice: "", error: "認証をキャンセルしました。" },
			},
		},
	},
};
