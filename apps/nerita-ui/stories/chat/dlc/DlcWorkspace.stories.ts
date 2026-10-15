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
	environmentView,
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

export const ExecutionEnvironment: Story = {
	play: ({ canvasElement }) => {
		workspaceBridge(canvasElement).emit({
			type: "dlc/state",
			view: environmentView(),
		});
	},
};

export const LongPressRemoval: Story = {
	play: async ({ canvasElement }) => {
		const user = userEvent.setup({ document: canvasElement.ownerDocument });
		const canvas = within(canvasElement);
		const document = within(canvasElement.ownerDocument.body);
		const bridge = workspaceBridge(canvasElement);
		const initial = environmentView();
		bridge.emit({ type: "dlc/state", view: initial });
		await userEvent.click(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		);
		const remove = document.getByRole("button", { name: "work-newを削除" });
		await waitFor(() =>
			expect(
				document.getByRole("button", { name: /現在のワークスペース/ }),
			).toHaveFocus(),
		);
		remove.focus();
		await user.keyboard("{Enter>}{/Enter}");
		// 短い押下を解除した後、削除の期限を過ぎても要求が送られないことを確認する。
		await new Promise((resolve) => setTimeout(resolve, 2100));
		await expect(
			bridge.sent.some(
				(message) => message.type === "dlc/worktreeRemove",
			),
		).toBe(false);
		remove.focus();
		await user.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(bridge.sent.at(-1)).toMatchObject({
					type: "dlc/worktreeRemove",
					targetId: "worktree",
				}),
			{ timeout: 3000 },
		);
		await user.keyboard("{/Enter}");
		await expect(document.getByRole("status")).toHaveTextContent("削除中");
		await expect(
			document.queryByRole("button", { name: "work-newを削除" }),
		).not.toBeInTheDocument();
		await expect(
			bridge.sent.filter(
				(message) => message.type === "dlc/worktreeRemove",
			),
		).toHaveLength(1);
		bridge.emit({
			type: "dlc/state",
			view: {
				...initial,
				targets: initial.targets.filter(
					(item) => item.id !== "worktree",
				),
			},
		});
		await waitFor(() =>
			expect(
				document.queryByRole("button", { name: "work-newを削除" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.keyboard("{Escape}");
	},
};

export const RunningWorktreeRemoval: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const document = within(canvasElement.ownerDocument.body);
		const bridge = workspaceBridge(canvasElement);
		bridge.emit({
			type: "dlc/state",
			view: {
				...environmentView(),
				running: [
					{
						intentId: second,
						attemptId: "other-run",
						targetId: "worktree",
					},
				],
			},
		});
		await userEvent.click(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		);
		await expect(
			document.getByRole("button", { name: "work-newを削除" }),
		).toBeDisabled();
		await expect(
			document.getByRole("button", { name: "feature-authを削除" }),
		).toBeEnabled();
		await expect(
			document.queryByRole("button", { name: "sampleを削除" }),
		).not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
	},
};

export const RemovalPending: Story = {
	args: { initialView: environmentView() },
	play: async ({ canvasElement }) => {
		const { bridge, document } =
			await requestWorktreeRemoval(canvasElement);
		bridge.emit({ type: "dlc/state", view: environmentView() });
		await expect(document.getByRole("status")).toHaveTextContent("削除中");
		await expect(
			document.queryByRole("button", { name: "work-newを削除" }),
		).not.toBeInTheDocument();
	},
};

export const RemovalFailed: Story = {
	args: { initialView: environmentView() },
	play: async ({ canvasElement }) => {
		const { bridge, document } =
			await requestWorktreeRemoval(canvasElement);
		const request = bridge.sent.at(-1);
		if (request?.type !== "dlc/worktreeRemove") {
			throw new Error("削除要求がありません");
		}
		bridge.emit({
			type: "request/failed",
			requestId: request.requestId,
			error: "削除に失敗しました",
		});
		await waitFor(() =>
			expect(
				document.getByRole("button", { name: "work-newを削除" }),
			).toBeEnabled(),
		);
		await expect(document.queryByRole("status")).not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
	},
};

/** 長押しで削除を要求し、応答を保留して製品の UI を削除処理中の状態にする。 */
async function requestWorktreeRemoval(canvasElement: HTMLElement) {
	const canvas = within(canvasElement);
	const document = within(canvasElement.ownerDocument.body);
	const bridge = workspaceBridge(canvasElement);
	const user = userEvent.setup();
	await user.click(
		await canvas.findByRole("combobox", { name: "DLC の Worktree" }),
	);
	// `Popover` を開いた直後のフォーカス移動で長押しが中断されないよう、移動完了後に削除ボタンへフォーカスを移す。
	await waitFor(() =>
		expect(
			document.getByRole("button", { name: /現在のワークスペース/ }),
		).toHaveFocus(),
	);
	document.getByRole("button", { name: "work-newを削除" }).focus();
	await user.keyboard("{Enter>}");
	await waitFor(
		() => expect(document.getByRole("status")).toHaveTextContent("削除中"),
		{ timeout: 3000 },
	);
	await user.keyboard("{/Enter}");
	return { bridge, document };
}

export const CodexUntrustedWorktree: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		workspaceBridge(canvasElement).emit({
			type: "dlc/state",
			view: untrustedWorktreeView("codex"),
		});
		const worktree = canvas.getByRole("combobox", {
			name: "DLC の Worktree",
		});
		await waitFor(() => expect(worktree).toHaveTextContent("work-new"));
		await userEvent.click(worktree);
		await expect(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "work-new（未信頼）",
			}),
		).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "ワークスペースを信頼する" }),
		);
		await expect(workspaceBridge(canvasElement).sent.at(-1)).toMatchObject({
			type: "dlc/trust",
		});
	},
};

export const PiUntrustedWorktree: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		workspaceBridge(canvasElement).emit({
			type: "dlc/state",
			view: untrustedWorktreeView("pi"),
		});
		const worktree = canvas.getByRole("combobox", {
			name: "DLC の Worktree",
		});
		await waitFor(() =>
			expect(worktree).toHaveTextContent("work-new（未信頼）"),
		);
		await userEvent.click(worktree);
		await expect(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "work-new（未信頼）",
			}),
		).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "ワークスペースを信頼する" }),
		);
		await expect(workspaceBridge(canvasElement).sent.at(-1)).toMatchObject({
			type: "dlc/trust",
		});
	},
};

export const AssignmentSelection: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const document = within(canvasElement.ownerDocument.body);
		const bridge = workspaceBridge(canvasElement);
		const initial = untrustedWorktreeView("codex");
		const assigned = initial;
		bridge.emit({ type: "dlc/state", view: assigned });
		const backend = canvas.getByRole("combobox", {
			name: "DLC のバックエンド",
		});
		const worktree = canvas.getByRole("combobox", {
			name: "DLC の Worktree",
		});
		await userEvent.click(backend);
		await userEvent.click(document.getByRole("option", { name: /^Pi$/ }));
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/backend",
			intentId: first,
			revision: 0,
			backend: "pi",
		});
		bridge.emit({
			type: "dlc/state",
			view: { ...assigned, backend: "pi" },
		});
		await waitFor(() => expect(backend).toHaveTextContent("Pi"));
		await userEvent.click(worktree);
		await userEvent.click(
			document.getByRole("button", { name: /現在のワークスペース/ }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/target",
			intentId: first,
			revision: 0,
			targetId: "main",
		});
		bridge.emit({
			type: "dlc/state",
			view: { ...assigned, backend: "pi", targetId: "main" },
		});
		await waitFor(() =>
			expect(worktree).toHaveTextContent("現在のワークスペース"),
		);
		await verifyAssignmentAvailability(canvasElement, assigned);
	},
};

/** 保存中・実行中・未選択時の操作可否を Host 応答ごとに確認する。 */
async function verifyAssignmentAvailability(
	canvasElement: HTMLElement,
	assigned: DlcView,
) {
	const canvas = within(canvasElement);
	const document = within(canvasElement.ownerDocument.body);
	const bridge = workspaceBridge(canvasElement);
	const backend = canvas.getByRole("combobox", {
		name: "DLC のバックエンド",
	});
	const worktree = canvas.getByRole("combobox", { name: "DLC の Worktree" });
	for (const state of [
		{ ...assigned, assignmentPending: true },
		{
			...assigned,
			running: [
				{
					intentId: first,
					attemptId: "active-run",
					targetId: "worktree",
				},
			],
		},
		{ ...assigned, selected: null },
	]) {
		bridge.emit({ type: "dlc/state", view: state });
		await waitFor(() => expect(backend).toBeDisabled());
		if (state.assignmentPending || state.selected === null) {
			await waitFor(() => expect(worktree).toBeDisabled());
		} else {
			await userEvent.click(worktree);
			await expect(
				document.getByRole("button", {
					name: /現在のワークスペース/,
				}),
			).toBeDisabled();
			await expect(
				document.getByRole("button", {
					name: "work-new（未信頼）",
				}),
			).toBeDisabled();
			await expect(
				document.getByRole("button", {
					name: "新しいWorktreeを作成",
				}),
			).toBeEnabled();
			await userEvent.keyboard("{Escape}");
		}
	}
}

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
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "新しいWorktreeを作成",
			}),
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
		await canvas.findByRole("button", { name: "ワークスペースを信頼する" }),
	);
	await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/trust" });
	await expect(
		within(canvas.getByLabelText("実行開始の保留")).getByRole("status"),
	).toHaveTextContent("ワークスペースを信頼してください");
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
