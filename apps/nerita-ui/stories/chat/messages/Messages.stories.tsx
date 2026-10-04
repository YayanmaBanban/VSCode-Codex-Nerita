// メッセージ内の参照リンクと Markdown の表示を確認する。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, spyOn, userEvent, within, waitFor } from "storybook/test";
import { Messages } from "../../../src/chat/messages/Messages";
import "../../../src/chat/chat.css";

const meta = {
	title: "Chat/Messages",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
/** メッセージ表示の確認用ストーリー。 */
type Story = StoryObj<typeof meta>;

/** 受信済みの長文と確定通知を別操作で渡し、文字送りの打ち切りを確認する。 */
function StreamingExample() {
	const [message, setMessage] = useState({
		id: "stream",
		role: "assistant" as const,
		text: "",
		streaming: false,
	});
	return (
		<main className="p-[14px]">
			{[100, 1000].map((length) => (
				<button
					type="button"
					key={length}
					onClick={() =>
						setMessage({
							id: `stream-${length}`,
							role: "assistant",
							text: "あ".repeat(length),
							streaming: true,
						})
					}
				>
					{length}文字を受信
				</button>
			))}
			<button
				type="button"
				onClick={() =>
					setMessage((current) => ({
						...current,
						text: `${current.text}👨‍👩‍👧‍👦追記`,
						streaming: true,
					}))
				}
			>
				追記を受信
			</button>
			<button
				type="button"
				onClick={() =>
					setMessage((current) => ({ ...current, streaming: false }))
				}
			>
				全文を確定
			</button>
			<Messages busy={message.streaming} messages={[message]} />
		</main>
	);
}

export const Streaming: Story = {
	render: () => <StreamingExample />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const length of [100, 1000]) {
			await userEvent.click(
				canvas.getByRole("button", {
					name: `${length}文字を受信`,
				}),
			);
			const content = canvasElement.querySelector(".message-markdown")!;
			await waitFor(async () => {
				await expect(content.textContent.length).toBeGreaterThan(0);
				await expect(content.textContent.length).toBeLessThan(length);
			});
			await userEvent.click(
				canvas.getByRole("button", { name: "全文を確定" }),
			);
			await expect(content).toHaveTextContent("あ".repeat(length));
		}
	},
};

/** 長いファイル名と Markdown・コードに囲まれた参照を狭幅で確認する。 */
export const References: Story = {
	render: () => {
		const path = {
			kind: "file" as const,
			name: "とても長いファイル名を持つ日本語のメッセージコンポーネント.tsx",
			path: "D:/workspace/long.tsx",
			uri: "file:///D:/workspace/long.tsx",
		};
		const text = `**確認対象** ${path.path}\nコード内: \`${path.path}\``;
		const references = [
			text.indexOf(path.path),
			text.lastIndexOf(path.path),
		].map((offset) => ({ offset, path }));
		return (
			<main className="p-[14px]">
				<Messages
					busy={false}
					send={() => {}}
					messages={[
						{ id: "user", role: "user", text, references },
						{ id: "answer", role: "assistant", text, references },
					]}
				/>
			</main>
		);
	},
};

/** Markdown の本文をそのままコピーし、結果はボタン内だけで示す。 */
export const AnswerCopy: Story = {
	render: () => (
		<main className="p-[14px]">
			<Messages
				busy={false}
				messages={[
					{
						id: "user",
						role: "user",
						text: "素材の一覧を確認してください。",
					},
					{
						id: "answer",
						role: "assistant",
						text: "**必要な素材**\n\n- 作戦記録: 75\n- 折金券: 510K",
					},
				]}
			/>
		</main>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
			undefined,
		);
		try {
			const button = canvas.getByRole("button", { name: "回答をコピー" });
			await userEvent.click(button);
			await expect(copy).toHaveBeenLastCalledWith(
				"**必要な素材**\n\n- 作戦記録: 75\n- 折金券: 510K",
			);
			await expect(button).toHaveAttribute("data-copy-result", "success");
			await expect(
				canvas.queryByText("コピーしました"),
			).not.toBeInTheDocument();

			copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
			await userEvent.click(button);
			await expect(button).toHaveAttribute("data-copy-result", "error");
			await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
			await userEvent.click(button);
			await expect(button).toHaveAttribute("data-copy-result", "success");
		} finally {
			copy.mockRestore();
		}
	},
};
