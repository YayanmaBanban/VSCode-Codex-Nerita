// 共通の質問カードで、複数の質問への回答・MCP の入力制約・Pi の長文入力と取り消しを検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import type { QuestionRequest } from "@nerita/shared/questions";
import QuestionStory from "./QuestionStory.svelte";
import { storyBridge } from "./storyBridgeElement";

const codex: QuestionRequest = {
	id: "question-codex",
	sessionId: "session",
	runId: "run",
	source: "Codex",
	title: "実装の方針を確認させてください",
	fields: [
		{
			id: "method",
			title: "どの方式で実装しますか？",
			required: true,
			allowOther: true,
			options: [
				{
					label: "既存の構成を使う",
					description:
						"既存コードとの整合性を保ち、変更を小さくします。",
				},
				{
					label: "構成を見直す",
					description: "新しい要件に合わせて設計を整理します。",
				},
			],
		},
		{ id: "code", title: "確認コード", secret: true, required: true },
	],
};
const meta = {
	title: "Chat/Questions",
	component: QuestionStory,
	parameters: { layout: "fullscreen" },
	args: { question: codex },
} satisfies Meta<typeof QuestionStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Codex: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await canvas.findByRole("region", { name: "Codexの質問" });
		await expect(canvas.queryByText(/回答を待っています/)).toBeNull();
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を送信" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"入力してください",
		);
		await expect(
			bridge.sent.some((message) => message.type === "question/respond"),
		).toBe(false);
		await userEvent.click(
			canvas.getByRole("radio", { name: "その他（自由入力）" }),
		);
		await userEvent.type(
			canvas.getByLabelText("どの方式で実装しますか？の自由入力"),
			"段階的に移行する",
		);
		const otherInput =
			canvas.getByLabelText("どの方式で実装しますか？の自由入力");
		const otherOption = canvas.getByRole("radio", {
			name: "その他（自由入力）",
		});
		const combined = otherOption.closest(".question-other-option");
		await expect(combined).toContainElement(otherInput);
		await userEvent.click(
			canvas.getByRole("radio", { name: /既存の構成を使う/ }),
		);
		await expect(otherOption).not.toBeChecked();
		await expect(otherInput).toHaveValue("段階的に移行する");
		await waitFor(async () => {
			await expect(
				otherInput.closest(".question-other")?.getBoundingClientRect()
					.height,
			).toBe(0);
		});
		await userEvent.click(otherOption);
		await waitFor(async () => {
			await expect(otherInput).toBeVisible();
		});
		await userEvent.keyboard("{Tab}");
		await expect(otherInput).toHaveFocus();
		await userEvent.type(otherInput, "段階的に移行する");
		await userEvent.type(
			canvas.getByLabelText("確認コード"),
			"test-only-code",
		);
		await expect(canvas.getByLabelText("確認コード")).toHaveAttribute(
			"type",
			"password",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を送信" }),
		);
		const response = bridge.sent.find(
			(message) => message.type === "question/respond",
		);
		await expect(response).toMatchObject({
			questionId: codex.id,
			sessionId: "session",
			runId: "run",
			action: "accept",
			answers: { method: "段階的に移行する", code: "test-only-code" },
		});
		await expect(
			bridge.sent.some((message) => message.type === "prompt/send"),
		).toBe(false);
		bridge.patchState({ questions: [] });
		await waitFor(async () => {
			await expect(
				canvas.queryByRole("region", { name: "Codexの質問" }),
			).toBeNull();
		});
	},
};

export const McpForm: Story = {
	args: {
		question: {
			id: "question-mcp",
			sessionId: "session",
			runId: "run",
			source: "MCP",
			title: "example-server: 接続先の設定を確認してください",
			allowDecline: true,
			fields: [
				{
					id: "count",
					title: "実行回数",
					description: "1〜4の整数で指定してください。",
					required: true,
					inputType: "integer",
					minimum: 1,
					maximum: 4,
				},
				{
					id: "enabled",
					title: "通知を有効にしますか？",
					required: true,
					options: [{ label: "true" }, { label: "false" }],
				},
				{ id: "note", title: "補足", required: false, multiline: true },
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.type(await canvas.findByLabelText("実行回数"), "1.5");
		const decline = canvas.getByRole("button", {
			name: "拒否",
		});
		await expect(decline).toHaveClass("group", "overflow-hidden");
		await expect(decline.querySelector("span")).toHaveClass(
			"bg-yellow-300",
		);
		await userEvent.click(canvas.getByRole("radio", { name: "true" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を送信" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"指定範囲の数値",
		);
		await expect(
			bridge.sent.some((message) => message.type === "question/respond"),
		).toBe(false);
		await userEvent.clear(canvas.getByLabelText("実行回数"));
		await userEvent.type(canvas.getByLabelText("実行回数"), "3");
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を送信" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "question/respond",
			action: "accept",
			answers: { count: "3", enabled: "true", note: "" },
		});
		bridge.patchState({ questions: [] });
		await waitFor(async () => {
			await expect(
				canvas.queryByRole("region", { name: "MCPの質問" }),
			).toBeNull();
		});
	},
};

export const PiEditor: Story = {
	args: {
		question: {
			id: "question-pi",
			sessionId: "session",
			runId: "run",
			source: "Pi",
			title: "実装前に補足してください",
			fields: [
				{
					id: "answer",
					title: "確認したい条件",
					description: "複数行で入力できます。",
					required: false,
					multiline: true,
					prefill:
						"既存の動作を維持する\n狭い画面でも操作できるようにする",
				},
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const editor = await canvas.findByLabelText("確認したい条件");
		await expect(editor).toHaveValue(
			"既存の動作を維持する\n狭い画面でも操作できるようにする",
		);
		await userEvent.type(editor, "\n途中で取り消せること");
		const cancel = canvas.getByRole("button", { name: "キャンセル" });
		await userEvent.hover(cancel);
		const curtain = cancel.querySelector("span");
		await expect(curtain).toHaveClass("bg-red-300");
		await expect(cancel).toHaveClass("group", "overflow-hidden");
		await expect(curtain).toHaveAttribute("aria-hidden", "true");
		await userEvent.click(cancel);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "question/respond",
			action: "cancel",
			answers: {},
		});
		bridge.patchState({ questions: [] });
		await waitFor(async () => {
			await expect(
				canvas.queryByRole("region", { name: "Piの質問" }),
			).toBeNull();
		});
	},
};
