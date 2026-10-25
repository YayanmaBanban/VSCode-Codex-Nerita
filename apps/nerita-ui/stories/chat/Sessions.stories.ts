// 実際のチャット画面でセッション一覧の各状態を観察する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SessionsStory from "./SessionsStory.svelte";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { storyBridge } from "./storyBridgeElement";
import { runtimeDiagnostics } from "../runtimeDiagnostics";

const meta = {
	...runtimeDiagnostics(),
	title: "Chat/Sessions",
	component: SessionsStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "history" },
} satisfies Meta<typeof SessionsStory>;
export default meta;
/** 履歴ペインのストーリー定義。 */
type Story = StoryObj<typeof meta>;
/** 履歴取得済みの空の会話で、最近の3件を観察する。 */
export const Recent: Story = { args: { scenario: "recent" } };
/** 更新順の3件だけを表示し、選択した履歴の復元要求を送る。 */
export const RestoreRecent: Story = {
	args: { scenario: "recent" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		const recent = await canvas.findByRole("region", {
			name: "最近のスレッド",
		});
		const rows = within(within(recent).getByRole("list")).getAllByRole(
			"button",
		);
		await expect(rows).toHaveLength(3);
		await expect(rows[0]).toHaveAccessibleName(
			"「セッション一覧と履歴の読み込みを実装」を開く",
		);
		await userEvent.click(rows[0]!);
		const requests = bridge.sent.filter(
			(message) => message.type === "session/load",
		);
		await expect(requests).toHaveLength(1);
		await expect(requests[0]?.sessionId).toBe("recent");
		bridge.patchState({ sessionPending: true });
		await waitFor(() => expect(rows[0]).toBeDisabled());
		bridge.patchState({
			sessionPending: false,
			sessionId: "recent",
			messages: [
				{ id: "restored", role: "user", text: "復元された会話" },
			],
		});
		await waitFor(() => expect(recent).not.toBeInTheDocument());
		await expect(canvas.getByText("復元された会話")).toBeVisible();
	},
};
/** 空の会話の一覧ボタンから既存の履歴ペインを開く。 */
export const OpenRecentHistory: Story = {
	args: { scenario: "recent" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const recent = await canvas.findByRole("region", {
			name: "最近のスレッド",
		});
		await userEvent.click(
			within(recent).getByRole("button", {
				name: "セッション一覧を開く",
			}),
		);
		await expect(
			await canvas.findByRole("complementary", {
				name: "セッション一覧",
			}),
		).toBeVisible();
		await expect(
			storyBridge(canvasElement).sent.some(
				(message) => message.type === "session/list",
			),
		).toBe(true);
	},
};
/** 削除確認の取消は履歴を閉じず、確定操作だけを Host へ送る。 */
export const History: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "セッション一覧" }),
		);
		const panel = await canvas.findByRole("complementary", {
			name: "セッション一覧",
		});
		const actions = await within(panel).findAllByRole("button", {
			name: /を削除$/,
		});
		const remove = actions[0];
		if (!remove) {
			throw new globalThis.Error("削除できるセッションがありません");
		}
		await userEvent.click(remove);
		await page.findByRole("alertdialog", {
			name: "セッションを削除しますか？",
		});
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await expect(panel).toBeVisible();
		await expect(remove).toHaveFocus();
		await expect(
			bridge.sent.filter((message) => message.type === "session/delete"),
		).toHaveLength(0);
		await waitFor(() =>
			expect(remove).toHaveStyle({ pointerEvents: "auto" }),
		);
		await userEvent.click(remove);
		const confirmation = await page.findByRole("alertdialog", {
			name: "セッションを削除しますか？",
		});
		await userEvent.click(
			within(confirmation).getByRole("button", {
				name: "セッションを削除",
			}),
		);
		const requests = bridge.sent.filter(
			(message) => message.type === "session/delete",
		);
		await expect(requests).toHaveLength(1);
		await expect(requests[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
	},
};
export const Paginated: Story = {
	args: { scenario: "paginated" },
	play: openSessions,
};

/** 開閉の各フレームで横スクロールを増やさず、表示完了後に閉じる操作へフォーカスする。 */
export const OpeningWithoutHorizontalScroll: Story = {
	args: { scenario: "paginated" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const document = canvasElement.ownerDocument;
		const samples: { width: number; scrollWidth: number }[] = [];
		let sampling = true;
		/** 終点だけでなく、スライド中に一時的に現れるスクロール領域も記録する。 */
		function sample() {
			if (!sampling) {
				return;
			}
			const root = document.documentElement;
			samples.push({
				width: root.clientWidth,
				scrollWidth: root.scrollWidth,
			});
			requestAnimationFrame(sample);
		}
		sample();
		try {
			const toggle = canvas.getByRole("button", {
				name: "セッション一覧",
			});
			toggle.focus();
			await userEvent.keyboard("{Enter}");
			const panel = await canvas.findByRole("complementary", {
				name: "セッション一覧",
			});
			await waitFor(() => expect(panel.getAnimations()).toHaveLength(0));
			await expect(
				within(panel).getByRole("button", {
					name: "セッション一覧を閉じる",
				}),
			).toHaveFocus();
			await expect(samples.length).toBeGreaterThan(1);
			await expect(
				samples.every(({ width, scrollWidth }) => scrollWidth <= width),
			).toBe(true);

			await userEvent.keyboard("{Escape}");
			await waitFor(() => expect(panel).not.toBeInTheDocument());
			await expect(toggle).toHaveFocus();
			await expect(
				samples.every(({ width, scrollWidth }) => scrollWidth <= width),
			).toBe(true);
		} finally {
			sampling = false;
		}
	},
};
export const Empty: Story = { args: { scenario: "empty" }, play: openSessions };
/** 説明が開いた状態から Escape と閉じるボタンで閉じても、破棄後の参照や説明が残らない。 */
export const ClosingWithTooltip: Story = {
	play: async (context) => {
		const canvas = within(context.canvasElement);
		const page = within(context.canvasElement.ownerDocument.body);
		const toggle = canvas.getByRole("button", {
			name: "セッション一覧",
		});
		for (const method of ["keyboard", "pointer"]) {
			await openSessions(context);
			const panel = await canvas.findByRole("complementary", {
				name: "セッション一覧",
			});
			const close = within(panel).getByRole("button", {
				name: "セッション一覧を閉じる",
			});
			await waitFor(() => expect(close).toHaveFocus());
			await waitFor(() =>
				expect(
					page.getByRole("tooltip", { name: /^閉じる$/ }),
				).toBeVisible(),
			);
			if (method === "keyboard") {
				await userEvent.keyboard("{Escape}");
			} else {
				await userEvent.click(close);
			}
			await waitFor(() => expect(panel).not.toBeInTheDocument());
			await expect(toggle).toHaveFocus();
			await waitFor(() =>
				expect(
					page.queryByRole("tooltip", {
						name: /^閉じる$/,
					}),
				).not.toBeInTheDocument(),
			);
		}
	},
};
export const Error: Story = {
	args: { scenario: "error" },
	play: async (context) => {
		await openSessions(context);
		const canvas = within(context.canvasElement);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "再試行" }),
		).toBeEnabled();
	},
};
export const Unsupported: Story = {
	args: { scenario: "unsupported" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "セッション一覧" }),
		).toBeDisabled();
		await expect(
			canvas.queryByRole("complementary", { name: "セッション一覧" }),
		).not.toBeInTheDocument();
	},
};
export const Loading: Story = {
	args: { scenario: "loading" },
	play: openSessions,
};
export const Rename: Story = {
	play: async (context) => {
		await openSessions(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(
			(
				await canvas.findAllByRole("button", { name: /の名前を変更$/ })
			)[0]!,
		);
		await expect(
			canvas.getByRole("textbox", { name: "新しいセッション名" }),
		).toBeVisible();
	},
};
export const DeleteConfirmation: Story = {
	play: async (context) => {
		await openSessions(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(
			(await canvas.findAllByRole("button", { name: /を削除$/ }))[0]!,
		);
		await expect(
			await within(context.canvasElement.ownerDocument.body).findByRole(
				"alertdialog",
			),
		).toBeVisible();
	},
};
export const Archived: Story = {
	play: async (context) => {
		await openSessions(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "アーカイブ" }),
		);
		await expect(
			(
				await canvas.findAllByRole("button", {
					name: /をアーカイブから戻す$/,
				})
			)[0],
		).toBeEnabled();
	},
};

/** 一覧を閉じずに、対象状態の表示と操作を確認できるようにする。 */
async function openSessions({ canvasElement }: { canvasElement: HTMLElement }) {
	const canvas = within(canvasElement);
	const trigger = canvas.getByRole("button", {
		name: "セッション一覧",
	});
	await waitFor(() =>
		expect(globalThis.getComputedStyle(trigger).pointerEvents).not.toBe(
			"none",
		),
	);
	await userEvent.click(trigger);
	await expect(
		await canvas.findByRole("complementary", { name: "セッション一覧" }),
	).toBeVisible();
}
