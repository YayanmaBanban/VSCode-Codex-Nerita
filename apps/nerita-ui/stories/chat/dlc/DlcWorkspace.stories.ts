// 選択待ち・作成失敗・モード切替を明示的な Host 応答で検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import type { DlcView } from "@nerita/shared/dlc/contracts";
import WorkspaceStory from "./WorkspaceStory.svelte";
import { storyBridge } from "../storyBridgeElement";
import type { StoryBridge } from "../mocks/storyBridge";
import {
	first,
	second,
	third,
	projection,
	view,
	untrustedWorktreeView,
} from "./workspaceState";

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

export const CodexUntrustedWorktree: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		workspaceBridge(canvasElement).emit({
			type: "dlc/state",
			view: untrustedWorktreeView("codex"),
		});
		await waitFor(() =>
			expect(canvas.getByLabelText("DLC の Worktree")).toHaveValue(
				"worktree",
			),
		);
		await expect(
			canvas.getByRole("option", { name: "work-new" }),
		).toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", { name: "実行先の信頼を確認" }),
		).not.toBeInTheDocument();
	},
};

export const PiUntrustedWorktree: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		workspaceBridge(canvasElement).emit({
			type: "dlc/state",
			view: untrustedWorktreeView("pi"),
		});
		await waitFor(() =>
			expect(canvas.getByLabelText("DLC の Worktree")).toHaveValue(
				"worktree",
			),
		);
		await expect(
			canvas.getByRole("option", {
				name: "work-new（未信頼）",
			}),
		).toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "実行先の信頼を確認" }),
		);
		await expect(workspaceBridge(canvasElement).sent.at(-1)).toMatchObject({
			type: "dlc/trust",
		});
	},
};

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
	await userEvent.click(canvas.getByRole("button", { name: "Intentの作成" }));
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
	args: { chatModes: true },
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
							"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
					},
				},
				{ intentId: second, title: "別の Intent", status: "running" },
			],
		};
		bridge.emit({ type: "dlc/state", view: held });
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "最初の Intent" }),
			).toHaveAccessibleDescription(
				"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
			),
		);
		await expect(
			within(canvas.getByLabelText("実行開始の保留")).getByRole("status"),
		).toHaveTextContent(
			"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
		);
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
			canvas.getByRole("button", { name: "Worktree を作成" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/worktreeCreate",
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
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
		backend: "pi",
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
					message: "ワークスペースを信頼してください",
				},
			},
			held.intents[1]!,
		],
	};
	bridge.emit({ type: "dlc/state", view: untrusted });
	await userEvent.click(
		await canvas.findByRole("button", { name: "実行先の信頼を確認" }),
	);
	await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/trust" });
	await expect(
		within(canvas.getByLabelText("実行開始の保留")).getByRole("status"),
	).toHaveTextContent(
		"ワークスペースを信頼してください",
	);
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
