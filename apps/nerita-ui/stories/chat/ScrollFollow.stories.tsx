// 本体の会話画面へ手動で更新を送り、閲覧位置と末尾追従を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { textToolContent } from "@nerita/shared/toolContent";
import { createStoryBridge } from "./mocks/storyBridge";
import { StoryChat as ChatApp } from "./StoryChat";

function ScrollFollowStory() {
	const control = useMemo(createScrollControl, []);
	return (
		<>
			<div className="fixed top-0 right-0 z-50">
				<button onClick={() => control.append()}>本文を追記</button>
				<button onClick={() => control.tool()}>ツールを追加</button>
				<button onClick={() => control.reset()}>会話を切替</button>
			</div>
			<ChatApp bridge={control.bridge} />
		</>
	);
}

/** 本文の追記と会話切替を、Host からの状態通知として再現する。 */
function createScrollControl() {
	let state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "scroll",
		messages: [
			{
				id: "user",
				role: "user",
				text: "添付ファイルを確認してください。",
				attachments: [
					{
						id: "file",
						name: "育成素材と必要数量の一覧をまとめた長いファイル名.txt",
						uri: "file:///workspace/materials.txt",
					},
				],
			},
			{
				id: "answer",
				role: "assistant",
				text: "段落の本文です。\n\n".repeat(40),
			},
		],
	};
	const bridge = createStoryBridge(state);
	const emit = () => bridge.emit({ type: "state/snapshot", state });
	return {
		bridge,
		append() {
			state = {
				...state,
				revision: state.revision + 1,
				messages: state.messages.map((message) =>
					message.role === "assistant"
						? {
								...message,
								text:
									message.text +
									"追記した本文です。\n\n".repeat(8),
							}
						: message,
				),
			};
			emit();
		},
		tool() {
			state = {
				...state,
				revision: state.revision + 1,
				tools: [
					{
						id: "reason",
						kind: "think",
						title: "推論",
						status: "in_progress",
						paths: [],
						content: [
							textToolContent(
								"**高さが変わるツール本文**\n\n".repeat(20),
							),
						],
					},
				],
			};
			emit();
		},
		reset() {
			state = {
				...state,
				revision: state.revision + 1,
				sessionId: `${state.revision}`,
				tools: [],
			};
			emit();
		},
	};
}
const meta = {
	title: "Chat/Scroll Follow",
	component: ScrollFollowStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ScrollFollowStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Updates: Story = {};

/** 空の会話にカードを追加し、内容が表示範囲を超えて初めてスクロールが必要になる状態を再現する。 */
function EmptyScrollFollowStory() {
	const control = useMemo(createEmptyScrollControl, []);
	return (
		<>
			<div className="fixed top-0 right-0 z-50">
				<button onClick={() => control.accept()}>
					送信を受け付ける
				</button>
				<button onClick={() => control.tool()}>カードを受信</button>
				<button
					onClick={() => {
						for (let index = 0; index < 20; index++) {
							control.tool();
						}
					}}
				>
					カードをまとめて受信
				</button>
				<button onClick={() => control.answer()}>回答を受信</button>
			</div>
			<ChatApp bridge={control.bridge} />
		</>
	);
}

/** 初回送信の受け付けと実行済みカード・回答の追加を、同じセッションの Host 通知として再現する。 */
function createEmptyScrollControl() {
	let state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "empty-scroll",
	};
	const bridge = createStoryBridge(state);
	const emit = () => bridge.emit({ type: "state/snapshot", state });
	return {
		bridge,
		accept() {
			const request = bridge.sent.find(
				(message) => message.type === "prompt/send",
			);
			if (request?.type !== "prompt/send") {
				return;
			}
			state = {
				...state,
				revision: state.revision + 1,
				run: "running",
				messages: [
					{
						id: "empty-user",
						order: -1,
						role: "user",
						text: request.text,
					},
				],
			};
			emit();
			bridge.emit({
				type: "prompt/accepted",
				requestId: request.requestId,
				mode: "start",
			});
		},
		tool() {
			const index = state.tools.length;
			state = {
				...state,
				revision: state.revision + 1,
				tools: [
					...state.tools,
					{
						id: `empty-tool-${index}`,
						order: index,
						kind: "execute",
						title: `確認結果 ${index + 1}`,
						status: "completed",
						paths: [],
					},
				],
			};
			emit();
		},
		answer() {
			state = {
				...state,
				revision: state.revision + 1,
				messages: [
					...state.messages,
					{
						id: "empty-answer",
						order: state.tools.length,
						role: "assistant",
						text: "確認が完了しました。",
					},
				],
			};
			emit();
		},
	};
}

/** 手動操作がなければ、カードの追加で表示範囲を超えても、最初の回答が届いても末尾への追従を続ける。 */
export const EmptyUpdates: Story = {
	render: () => <EmptyScrollFollowStory />,
};
export const EmptyConversation: Story = {
	...EmptyUpdates,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await userEvent.type(
			canvas.getByRole("textbox"),
			"作業を進めてください。",
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "送信を受け付ける" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("textbox").textContent).toBe(""),
		);
		const receive = canvas.getByRole("button", { name: "カードを受信" });
		for (let index = 1; index <= 40; index++) {
			await userEvent.click(receive);
			await waitFor(() =>
				expect(
					canvas.getByRole("button", {
						name: `確認結果 ${index} 完了`,
					}),
				).toBeVisible(),
			);
			await waitFor(() =>
				expect(
					conversation.scrollHeight -
						conversation.clientHeight -
						conversation.scrollTop,
				).toBeLessThan(5),
			);
		}
		await expect(conversation.scrollTop).toBeGreaterThan(0);
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を受信" }),
		);
		await waitFor(() =>
			expect(canvas.getByText(/確認が完了しました/)).toBeVisible(),
		);
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", {
					name: "メッセージの末尾へ移動",
				}),
			).not.toBeInTheDocument(),
		);
	},
};

/** 再計測中の上方向の位置補正を手動操作と誤認せず、カード追加への追従を続ける。 */
export const LayoutCorrection: Story = {
	...EmptyUpdates,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await userEvent.click(
			canvas.getByRole("button", { name: "カードをまとめて受信" }),
		);
		await waitFor(() => expect(conversation.scrollTop).toBeGreaterThan(0));
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);

		const previousHeight = conversation.scrollHeight;
		const previousTop = conversation.scrollTop;
		// 内容の高さが増えたときにスクロール位置を上へずらし、ブラウザや仮想一覧による位置補正を再現する。
		const correction = new Promise<void>((resolve) => {
			const observer = new MutationObserver(() => {
				if (conversation.scrollHeight <= previousHeight) {
					return;
				}
				observer.disconnect();
				conversation.scrollTop = previousTop - 40;
				resolve();
			});
			observer.observe(conversation, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style"],
			});
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "カードを受信" }),
		);
		await correction;
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", {
					name: "メッセージの末尾へ移動",
				}),
			).not.toBeInTheDocument(),
		);
	},
};
