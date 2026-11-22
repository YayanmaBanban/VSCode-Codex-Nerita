// モバイル画面を、Tailscale に接続せず確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { RemoteChatState } from "@nerita/shared/remote/contracts";
import RemoteApp from "../../src/remote/RemoteApp.svelte";
import {
	RemoteResponseError,
	type RemoteTransport,
} from "../../src/remote/api";

const meta = {
	title: "Remote/Remote App",
	component: RemoteApp,
	parameters: { layout: "fullscreen" },
	args: { hostname: "desktop.example.ts.net" },
} satisfies Meta<typeof RemoteApp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** PC の選択を初期取得とイベントの両方で返す。 */
function transport(
	backend: RemoteChatState["backend"],
	paired = true,
	workspace = sampleWorkspace,
): RemoteTransport {
	const snapshot: RemoteChatState = {
		backend,
		backendGeneration: 0,
		availableBackends: [
			{ id: "pi", selectable: true },
			{ id: "codex", selectable: true },
		],
		connectionGeneration: "cb972812-dadc-4e0b-b735-4c034e516619",
		revision: 0,
		switching: false,
		connection: "ready",
		sessionId: "storybook",
		sessionTitle: "モバイルから作業状況を確認",
		runId: null,
		run: "completed",
		messages: [
			{
				id: "user",
				role: "user",
				text: "作業の進捗を教えてください。",
				streaming: false,
			},
			{
				id: "assistant",
				role: "assistant",
				text: "変更を適用し、ローカルテストまで完了しました。",
				streaming: false,
			},
		],
		tools: [],
		pendingApprovals: [],
		error: null,
		capabilities: { send: true, stop: false, approve: false },
		truncated: false,
		canManageSessions: true,
		sessions: [{ id: "previous", title: "以前の会話" }],
	};
	return {
		bootstrap: () => {
			if (!paired) {
				return Promise.reject(
					new RemoteResponseError(401, "ペアリングが必要です。"),
				);
			}
			return Promise.resolve({ csrf: "a".repeat(64), state: snapshot });
		},
		pair: () => {
			paired = true;
			return Promise.resolve();
		},
		logout: () => {
			paired = false;
			return Promise.resolve();
		},
		sendAction: () => Promise.resolve(),
		workspace,
		connectEvents: (receive) => {
			let readyState: number = EventSource.OPEN;
			queueMicrotask(() => {
				if (readyState === EventSource.OPEN) {
					receive(snapshot);
				}
			});
			return {
				get readyState() {
					return readyState;
				},
				close: () => {
					readyState = EventSource.CLOSED;
				},
			};
		},
	};
}

/** 変更ファイルの一覧と表示するテキストを用意する。 */
const sampleWorkspace: NonNullable<RemoteTransport["workspace"]> = (
	operation,
) => {
	if (operation.type === "read") {
		return Promise.resolve({
			type: "file",
			path: operation.path,
			text: "読み取り専用のテキスト",
		});
	}
	return Promise.resolve({
		type: "list",
		files: [{ path: "notes.txt", status: " M", canStage: true }],
		index: null,
		push: null,
	});
};

export const Pairing: Story = {
	name: "ペアリング",
	render: (args) => ({
		Component: RemoteApp,
		props: { ...args, transport: transport("codex", false) },
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByLabelText("8桁のペアリングコード"),
		).toBeVisible();
	},
};

/** PC と同じオプションメニューで、バックエンドの選択を確認する。 */
async function expectSelectedBackend(element: HTMLElement, backend: string) {
	const canvas = within(element);
	const page = within(element.ownerDocument.body);
	const trigger = await canvas.findByRole("button", { name: "オプション" });
	await userEvent.click(trigger);
	const submenu = await page.findByRole("menuitem", { name: "バックエンド" });
	await userEvent.click(submenu);
	await expect(
		await page.findByRole("menuitemradio", { name: backend }),
	).toHaveAttribute("aria-checked", "true");
	await userEvent.keyboard("{Escape}{Escape}");
	await waitFor(() =>
		expect(page.queryByRole("menu")).not.toBeInTheDocument(),
	);
	await waitFor(() =>
		expect(getComputedStyle(trigger).pointerEvents).toBe("auto"),
	);
}

export const CodexSelected: Story = {
	name: "PC で Codex を選択済み",
	render: (args) => ({
		Component: RemoteApp,
		props: { ...args, transport: transport("codex") },
	}),
	play: async ({ canvasElement }) => {
		await expectSelectedBackend(canvasElement, "Codex");
	},
};

export const Workspace: Story = {
	name: "作業ツリーとセッション履歴",
	render: (args) => ({
		Component: RemoteApp,
		props: { ...args, transport: transport("codex") },
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("作業の進捗を教えてください。"),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", { name: "サイドバーを開く" }),
		).not.toBeInTheDocument();
		const panel = await canvas.findByRole("complementary", {
			name: "サイドバー",
		});
		await expect(panel.getBoundingClientRect().left).toBeLessThan(
			canvas.getByRole("main").getBoundingClientRect().left,
		);
		const sidebar = within(panel);
		const history = canvas.getByRole("button", { name: "セッション一覧" });
		await waitFor(() =>
			expect(getComputedStyle(history).pointerEvents).toBe("auto"),
		);
		await userEvent.click(history);
		await expect(
			sidebar.queryByRole("heading", { name: "サイドバー" }),
		).not.toBeInTheDocument();
		const historyPanel = await canvas.findByRole("complementary", {
			name: "セッション一覧",
		});
		await expect(
			within(historyPanel).getByRole("button", {
				name: "以前の会話を開く",
			}),
		).toBeVisible();
		await expect(
			sidebar.queryByRole("list", { name: "セッション履歴" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			within(historyPanel).getByRole("button", {
				name: "セッション一覧を閉じる",
			}),
		);
		await waitFor(() => expect(history).toHaveFocus());
		await userEvent.click(
			await sidebar.findByRole("button", { name: /notes\.txt$/u }),
		);
		const preview = within(
			await canvas.findByRole("region", { name: "ファイル内容" }),
		);
		await expect(preview.getByText("読み取り専用のテキスト")).toBeVisible();
		await expect(preview.queryByRole("textbox")).not.toBeInTheDocument();
		await userEvent.click(
			preview.getByRole("button", { name: "チャットを全体に表示" }),
		);
		await expect(
			canvas.queryByRole("region", { name: "ファイル内容" }),
		).not.toBeInTheDocument();
	},
};

export const ManyChanges: Story = {
	name: "大量の変更ファイル",
	render: (args) => ({
		Component: RemoteApp,
		props: {
			...args,
			transport: transport("codex", true, manyFilesWorkspace),
		},
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByRole("list", { name: "変更ファイル" });
		await expect(within(list).getAllByRole("listitem")).toHaveLength(80);
		await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
		const update = canvas.getByRole("button", {
			name: "変更ファイルを更新",
		});
		await expect(update).toHaveTextContent(/^$/u);
		await userEvent.hover(update);
		const page = within(canvasElement.ownerDocument.body);
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			"変更ファイルを更新",
		);
		const lastStage = within(list).getByRole("button", {
			name: "src/features/feature-80.ts をステージ",
		});
		lastStage.scrollIntoView({ block: "nearest" });
		await expect(list.scrollTop).toBeGreaterThan(0);
		await expect(lastStage).toHaveTextContent(/^$/u);
	},
};

/** 独立したスクロールを確認できる件数の変更データを返す。 */
const manyFilesWorkspace: NonNullable<RemoteTransport["workspace"]> = (
	operation,
	csrf,
) => {
	if (operation.type === "list") {
		const files = Array.from({ length: 80 }, (_, index) => ({
			path: `src/features/feature-${index + 1}.ts`,
			status: " M",
			canStage: true,
		}));
		return Promise.resolve({
			type: "list",
			files,
			index: null,
			push: null,
		});
	}
	return sampleWorkspace(operation, csrf);
};

export const PiSelected: Story = {
	name: "PC で Pi を選択済み",
	render: (args) => ({
		Component: RemoteApp,
		props: { ...args, transport: transport("pi") },
	}),
	play: async ({ canvasElement }) => {
		await expectSelectedBackend(canvasElement, "Pi");
	},
};
