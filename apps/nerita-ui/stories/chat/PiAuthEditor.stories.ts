// Host の固定 DTO と送信記録を使い、認証の完了をストーリー内では導出しない。
import type { PiAuthState } from "@nerita/shared/piAuth";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { fn, expect, userEvent, within } from "storybook/test";
import PiAuthEditor from "../../src/pi/PiAuthEditor.svelte";

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
export const OptionPrompt: Story = {
	args: {
		state: {
			...authInitialState,
			active: "openai-oauth",
			prompt: {
				id: "openai-oauth",
				message: "認証先を選択",
				secret: false,
				options: [
					{ id: "work", label: "仕事用" },
					{ id: "personal", label: "個人用" },
				],
			},
		},
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("combobox")).toBeVisible();
		await expect(
			within(canvasElement).getByRole("button", { name: "送信" }),
		).toBeDisabled();
	},
};
export const Accounts: Story = {
	args: {
		state: {
			...authInitialState,
			items: [
				{
					id: "google",
					name: "Google",
					configured: true,
					accounts: [
						{
							id: "work",
							name: "仕事用",
							mode: "secret-storage",
							active: true,
						},
						{
							id: "personal",
							name: "個人用",
							mode: "session",
							active: false,
						},
					],
					methods: [
						{ id: "google-add", name: "OAuthでログイン" },
						{ id: "google-personal", name: "使用: 個人用" },
						{ id: "google-delete", name: "削除: 個人用" },
					],
				},
			],
		},
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Google/ }));
		await expect(
			canvas.getByText("使用中 · 仕事用 · VS Code に保存"),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "使用: 個人用" }),
		);
		await expect(args.send).toHaveBeenLastCalledWith({
			type: "start",
			id: "google-personal",
		});
	},
};
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
		await expect(
			canvas.getByPlaceholderText("APIキーを入力してください"),
		).toHaveFocus();
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
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /^OpenAI/ }),
		);
		await expect(within(canvasElement).getByRole("status")).toBeVisible();
	},
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
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /^OpenAI/ }),
		);
		await expect(within(canvasElement).getByRole("alert")).toBeVisible();
	},
	args: {
		state: {
			...authInitialState,
			feedback: {
				openai: { notice: "", error: "認証をキャンセルしました。" },
			},
		},
	},
};
export const NoProviders: Story = {
	args: { state: { ...authInitialState, items: [] } },
};
export const ProviderError: Story = {
	args: {
		state: {
			...authInitialState,
			feedback: {
				openai: {
					error: "認証サービスへ接続できません。再試行してください。",
					notice: "",
				},
			},
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^OpenAI/ }));
		await expect(canvas.getByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "APIキーを設定" }),
		).toBeEnabled();
	},
};

export const RevokedOAuth: Story = oauthFailureStory(
	"使用: 仕事用 OAuth: この認証は無効化されています。OAuthでログインし直してください。",
);
export const OAuthReauthenticationRequired: Story = oauthFailureStory(
	"使用: 仕事用 OAuth: この認証は現在使用できません。OAuthでログインし直してください。",
);
export const OAuthNetworkFailure: Story = oauthFailureStory(
	"使用: 仕事用 OAuth: 認証サービスとの通信に失敗し、認証状態を確認できませんでした。再試行してください。",
);
export const OAuthPermissionDenied: Story = oauthFailureStory(
	"使用: 仕事用 OAuth: この認証にはアクセス権限がありません。アカウントの権限を確認してください。",
);

/** 操作後もエラーを残し、対象のアカウントと再ログイン・再試行のボタンを目視確認できるようにする。 */
function oauthFailureStory(error: string): Story {
	return {
		args: {
			state: {
				...authInitialState,
				items: [
					{
						id: "openai",
						name: "OpenAI",
						configured: true,
						accounts: [
							{
								id: "work",
								name: "仕事用 OAuth",
								mode: "secret-storage",
								active: true,
							},
						],
						methods: [
							{ id: "openai-work", name: "使用: 仕事用 OAuth" },
							{ id: "openai-oauth", name: "OAuthでログイン" },
							{ id: "openai-delete", name: "削除: 仕事用 OAuth" },
						],
					},
				],
				feedback: { openai: { notice: "", error } },
			},
		},
		play: async ({ canvasElement, args }) => {
			const canvas = within(canvasElement);
			await userEvent.click(
				canvas.getByRole("button", { name: /^OpenAI/ }),
			);
			await expect(canvas.getByRole("alert")).toBeVisible();
			await expect(
				canvas.getByRole("button", { name: "使用: 仕事用 OAuth" }),
			).toBeEnabled();
			await userEvent.click(
				canvas.getByRole("button", { name: "OAuthでログイン" }),
			);
			await expect(args.send).toHaveBeenLastCalledWith({
				type: "start",
				id: "openai-oauth",
			});
		},
	};
}
