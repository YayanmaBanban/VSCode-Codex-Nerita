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
		targets: [],
		targetId: null,
		targetBusy: false,
		assignmentPending: false,
		running: [],
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
		let initialized = false;
		return {
			...mock,
			postMessage(message: UiMessage) {
				mock.postMessage(message);
				if (message.type === "ui/ready" && !initialized) {
					initialized = true;
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
		const chatButton = canvas.getByRole("button", {
			name: "Chat",
		});
		const dlcButton = canvas.getByRole("button", {
			name: "DLC",
		});
		const document = within(canvasElement.ownerDocument.body);
		await expect(chatButton).toHaveAttribute("aria-pressed", "true");
		await userEvent.hover(chatButton);
		await waitFor(() =>
			expect(
				document.getByRole("tooltip", { name: "チャットモード" }),
			).toBeVisible(),
		);
		await userEvent.unhover(chatButton);
		await userEvent.hover(dlcButton);
		await waitFor(() =>
			expect(
				document.getByRole("tooltip", { name: "ライフサイクルモード" }),
			).toBeVisible(),
		);
		await userEvent.click(dlcButton);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/open" });
		// Host から DLC エディタを開いた通知が届くまで、選択枠はチャットモードのままにする。
		await expect(chatButton).toHaveAttribute("aria-pressed", "true");
		bridge.emit({ type: "dlc/state", view: view() });
		await waitFor(() =>
			expect(dlcButton).toHaveAttribute("aria-pressed", "true"),
		);
		await expect(
			await canvas.findByLabelText("Codexへのメッセージ"),
		).toBeVisible();
		await expect(
			canvas.queryByLabelText("DLC の実行情報"),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByLabelText("Intent のタイトル"),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "新しいチャット" }),
		).toBeVisible();
		await userEvent.click(chatButton);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "ui/setMode",
			mode: "chat",
		});
		bridge.emit({ type: "dlc/state", view: { ...view(), mode: "chat" } });
		await waitFor(() =>
			expect(chatButton).toHaveAttribute("aria-pressed", "true"),
		);
		await expect(
			canvas.getByLabelText("Codexへのメッセージ"),
		).toBeVisible();
	},
};

export const StartHold: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		const selected = {
			...projection(first, "最初の Intent"),
			canRun: true,
		};
		const held: DlcView = {
			...view(selected),
			targetId: "main",
			targetBusy: true,
			targets: [
				{
					id: "main",
					name: "sample",
					directory: "sample",
					branch: "main",
					main: true,
					removable: false,
					trusted: true,
				},
			],
			running: [
				{ intentId: second, attemptId: "other-run", targetId: "main" },
			],
			intents: [
				{
					intentId: first,
					title: selected.title,
					status: "idle",
					startHold: {
						reason: "worktree-required",
						message:
							"この実行先は別の処理で使用中です。独立した Worktree を選択してください。",
					},
				},
				{ intentId: second, title: "別の Intent", status: "running" },
			],
		};
		bridge.emit({ type: "dlc/state", view: held });
		await expect(await canvas.findByText("Worktree が必要")).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: /Phase 3 · Construction/ }),
		);
		await expect(
			canvas.getByRole("button", { name: "手動タスクを実行" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: /Phase 3 · Construction/ }),
		).toHaveTextContent("実行保留");
		await expect(
			canvas.getByRole("button", { name: /Phase 0 · Initialization/ }),
		).toHaveTextContent("完了");
		await userEvent.click(
			canvas.getByRole("button", { name: "新しい Worktree を作成" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/worktreeCreate",
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "開始条件を再確認" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/read" });
		await verifyTrustRelease(canvasElement, bridge, held);
	},
};

/** 信頼操作の応答を受けるまで保留し、表示更新だけでは Run を送信しない。 */
async function verifyTrustRelease(
	element: HTMLElement,
	bridge: StoryBridge,
	held: DlcView,
) {
	const canvas = within(element);
	const selected = held.selected!;
	const untrusted: DlcView = {
		...held,
		targetId: "worktree",
		targetBusy: false,
		targets: [
			...held.targets,
			{
				id: "worktree",
				name: "work-new",
				directory: "work-new",
				branch: null,
				main: false,
				removable: true,
				trusted: false,
			},
		],
		intents: [
			{
				intentId: first,
				title: selected.title,
				status: "idle",
				startHold: {
					reason: "trust-required",
					message: "実行先の Nerita Trust を確認してください。",
				},
			},
			held.intents[1]!,
		],
	};
	bridge.emit({ type: "dlc/state", view: untrusted });
	await userEvent.click(
		await canvas.findByRole("button", { name: "信頼設定を開く" }),
	);
	await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/trust" });
	bridge.emit({
		type: "dlc/state",
		view: {
			...untrusted,
			targets: untrusted.targets.map((target) => ({
				...target,
				trusted: true,
			})),
			intents: [
				{ intentId: first, title: selected.title, status: "idle" },
				held.intents[1]!,
			],
		},
	});
	await waitFor(async () => {
		await expect(
			canvas.getByRole("button", { name: "手動タスクを実行" }),
		).toBeEnabled();
	});
	await expect(
		bridge.sent.some((message) => message.type === "dlc/action"),
	).toBe(false);
	await userEvent.click(
		canvas.getByRole("button", { name: "手動タスクを実行" }),
	);
	await expect(bridge.sent.at(-1)).toMatchObject({
		type: "dlc/action",
		intentId: first,
		revision: 0,
		action: { type: "run" },
	});
}
