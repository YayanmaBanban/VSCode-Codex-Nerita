// 選択待ち・作成失敗とモード切替を、実コンポーネントと明示的な Host 応答で確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import type { DlcProjection, DlcView } from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import { DlcWorkspace } from "../../../src/chat/dlc/DlcWorkspace";
import { StoryChat, storyBridge } from "../StoryChat";
import { createChatStoryBridge } from "../mocks/mockBridge";
import { createStoryBridge, type StoryBridge } from "../mocks/storyBridge";
import { scenarioState } from "../fixtures/chatState";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const third = "00000000-0000-4000-8000-000000000003";
function projection(intentId: string, title: string): DlcProjection {
	return {
		intentId,
		title,
		request: `${title} の依頼原文`,
		profile: "classic",
		workflowStatus: "in-flight",
		revision: 0,
		stage: "planning",
		workItems: [],
		canRun: false,
		canCancel: false,
		routingReason: "unsupported-stage",
		stages: [
			{
				id: "0.1",
				name: "Workspace",
				selection: "execute",
				status: "completed",
				reason: "初期化済み",
			},
			{
				id: "2.1",
				name: "Requirements",
				selection: "execute",
				status: "pending",
				reason: "実行待ち",
			},
			{
				id: "3.1",
				name: "Construction",
				selection: "execute",
				status: "pending",
				reason: "実行待ち",
			},
		],
	};
}
function view(selected = projection(first, "最初の Intent")): DlcView {
	return {
		mode: "dlc",
		backend: "codex",
		error: null,
		active: null,
		execution: null,
		selected,
		environment: { workspace: "sample", branch: "feature/dlc-ui" },
		intents: [
			{ intentId: first, title: "最初の Intent", status: "idle" },
			{ intentId: second, title: "別の Intent", status: "idle" },
		],
	};
}

function WorkspaceStory() {
	const bridge = useMemo(() => {
		const mock = createStoryBridge(scenarioState("empty"));
		return {
			...mock,
			postMessage(message: UiMessage) {
				mock.postMessage(message);
				if (message.type === "ui/ready") {
					mock.emit({
						type: "dlc/editorState",
						state: { expanded: { [first]: [0], [second]: [0] } },
					});
					mock.emit({ type: "dlc/state", view: view() });
				}
			},
		};
	}, []);
	return (
		<div
			data-story-dlc
			ref={(element) => {
				if (element) {
					Object.assign(element, { bridge });
				}
			}}
		>
			<DlcWorkspace bridge={bridge} />
		</div>
	);
}
function workspaceBridge(canvas: HTMLElement): StoryBridge {
	const element = canvas.querySelector<HTMLElement & { bridge: StoryBridge }>(
		"[data-story-dlc]",
	);
	if (!element) {
		throw new Error("DLC の作業画面がありません。");
	}
	return element.bridge;
}

const meta = {
	title: "Chat/DLC Workspace",
	component: WorkspaceStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SelectionAndCreation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await expect(
			await canvas.findByText("最初の Intent の依頼原文"),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: /Phase 3 · Construction/ }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/editorState",
			state: { expanded: { [first]: [0, 3] } },
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "別の Intent" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/select",
			intentId: second,
		});
		await expect(
			canvas.queryByText("最初の Intent の依頼原文"),
		).not.toBeInTheDocument();
		bridge.emit({
			type: "dlc/state",
			view: view(projection(second, "別の Intent")),
		});
		await expect(
			await canvas.findByText("別の Intent の依頼原文"),
		).toBeVisible();
		await verifyCreationFailure(canvasElement, bridge);
	},
};

async function verifyCreationFailure(
	element: HTMLElement,
	bridge: StoryBridge,
) {
	const canvas = within(element);
	await userEvent.click(
		canvas.getByRole("button", { name: "新しい Intent" }),
	);
	await userEvent.type(
		canvas.getByLabelText("Intent のタイトル"),
		"新しい作業",
	);
	await userEvent.type(canvas.getByLabelText("開発したい内容"), "依頼の原文");
	await userEvent.click(
		canvas.getByRole("button", { name: "Intent を作成" }),
	);
	const request = bridge.sent.at(-1);
	if (request?.type !== "dlc/create") {
		throw new Error("作成要求がありません。");
	}
	bridge.emit({
		type: "request/failed",
		requestId: request.requestId,
		error: "保存に失敗しました。",
	});
	await expect(await canvas.findByRole("alert")).toHaveTextContent(
		/保存に失敗/,
	);
	await expect(canvas.getByLabelText("開発したい内容")).toHaveValue(
		"依頼の原文",
	);
	await userEvent.click(
		canvas.getByRole("button", { name: "Intent を作成" }),
	);
	const created = projection(third, "新しい作業");
	bridge.emit({
		type: "dlc/state",
		view: {
			...view(created),
			intents: [
				...view().intents,
				{ intentId: third, title: created.title, status: "idle" },
			],
		},
	});
	await waitFor(async () => {
		await expect(
			canvas.getByRole("button", { name: "新しい作業" }),
		).toHaveAttribute("aria-pressed", "true");
	});
	await expect(
		canvas.queryByLabelText("Intent のタイトル"),
	).not.toBeInTheDocument();
}

export const ChatModes: Story = {
	render: () => <StoryChat bridge={createChatStoryBridge("empty")} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		bridge.emit({ type: "dlc/state", view: view() });
		await expect(
			await canvas.findByLabelText("DLC の実行情報"),
		).toBeVisible();
		await expect(
			canvas.queryByLabelText("Intent のタイトル"),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", { name: "新しいチャット" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByLabelText("Codexへのメッセージ"),
		).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "ui/setMode",
			mode: "chat",
		});
		bridge.emit({ type: "dlc/state", view: { ...view(), mode: "chat" } });
		await expect(
			await canvas.findByLabelText("Codexへのメッセージ"),
		).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "DLC" }));
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/open" });
	},
};
