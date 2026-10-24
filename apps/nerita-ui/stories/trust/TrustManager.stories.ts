// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import TrustPreview from "./TrustPreview.svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { TrustRequest, TrustReply } from "@nerita/shared/workspaceTrust";
import { tick } from "svelte";

const meta = { title: "Trust/Manager", component: TrustPreview } satisfies Meta<
	typeof TrustPreview
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Empty: Story = { args: { empty: true } };
export const Loading: Story = { args: { manual: true } };
export const HostError: Story = {
	args: { error: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(canvas.queryByRole("article")).not.toBeInTheDocument();
		await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "再読み込み" }),
		).toBeEnabled();
	},
};
export const NoSearchResults: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("searchbox", { name: "フォルダを検索" }),
			"missing-workspace",
		);
		await expect(canvas.queryByRole("article")).not.toBeInTheDocument();
	},
};
export const Codex: Story = { args: { backend: "codex" } };
export const Help: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const help = canvas.getByRole("button", { name: "信頼設定の保存先" });
		help.focus();
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		await userEvent.hover(help);
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
	},
};

export const Confirmation: Story = {
	args: { backend: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const body = within(canvasElement.ownerDocument.body);
		const row = within(
			(await canvas.findAllByRole("article")).find((element) =>
				element.textContent.includes("projects/codex-unset"),
			)!,
		);
		await userEvent.click(row.getByRole("button", { name: "信頼する" }));
		const dialog = within(await body.findByRole("alertdialog"));
		await userEvent.click(
			dialog.getByRole("button", { name: "キャンセル" }),
		);
		await waitFor(() =>
			expect(body.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await waitFor(() =>
			expect(
				globalThis.getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
		await expect(
			row.getByRole("button", { name: "信頼する" }),
		).toBeEnabled();
		await userEvent.click(row.getByRole("button", { name: "信頼する" }));
		await userEvent.click(
			within(await body.findByRole("alertdialog")).getByRole("button", {
				name: "このフォルダを信頼する",
			}),
		);
		await expect(
			row.getByRole("button", { name: "信頼を取り消す" }),
		).toBeEnabled();
		await waitFor(() =>
			expect(body.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await waitFor(() =>
			expect(
				globalThis.getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
	},
};

export const DelayedReplies: Story = {
	args: { backend: "codex", manual: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const fixture = canvasElement.querySelector<
			HTMLElement & {
				sent: TrustRequest[];
				emit: (reply: TrustReply) => void;
			}
		>("[data-story-trust]");
		if (!fixture) {
			throw new Error("信頼管理のテスト用要素が見つかりません。");
		}
		const first = {
			root: "projects/a",
			trust: "trusted",
			origin: "workspace",
			updatedAt: null,
		} as const;
		const second = { ...first, root: "projects/b" };
		const state = { type: "state", backend: "codex", error: null } as const;
		fixture.emit({
			...state,
			requestId: fixture.sent.at(-1)?.requestId,
			revision: 1,
			records: [second, first],
		});
		await tick();
		const rows = await canvas.findAllByRole("article");
		await expect(rows[0]).toHaveTextContent(first.root);
		await userEvent.click(
			within(rows[0]!).getByRole("button", {
				name: "信頼を取り消す",
			}),
		);
		const requestId = fixture.sent.at(-1)?.requestId;
		fixture.emit({
			...state,
			revision: 2,
			records: [
				{ ...first, trust: "untrusted" },
				{ ...second, trust: "untrusted" },
			],
		});
		await tick();
		await expect(
			within(rows[0]!).getByRole("button", {
				name: "信頼を取り消す",
			}),
		).toBeDisabled();
		fixture.emit({
			...state,
			requestId,
			revision: 3,
			records: [second, { ...first, trust: "untrusted" }],
		});
		await tick();
		await expect(
			within(rows[0]!).getByRole("button", {
				name: "信頼する",
			}),
		).toBeEnabled();
		fixture.emit({
			...state,
			revision: 1,
			records: [{ ...second, trust: "untrusted" }, first],
		});
		await tick();
		await expect(
			within(rows[1]!).getByRole("button", {
				name: "信頼を取り消す",
			}),
		).toBeEnabled();
		await expect(
			(await canvas.findAllByRole("article"))[0],
		).toHaveTextContent(first.root);
	},
};

export const KeyboardRemoval: Story = {
	args: { backend: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const user = userEvent.setup({ document: canvasElement.ownerDocument });
		const fixture = canvasElement.querySelector<
			HTMLElement & { sent: TrustRequest[] }
		>("[data-story-trust]");
		if (!fixture) {
			throw new Error("信頼管理のテスト用要素が見つかりません。");
		}
		const remove = await canvas.findByRole("button", {
			name: /projects\/codex-unset.*削除/,
		});
		remove.focus();
		await user.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(fixture.sent.at(-1)).toMatchObject({
					type: "remove",
					root: "projects/codex-unset",
					backend: "codex",
				}),
			{ timeout: 3000 },
		);
		await user.keyboard("{/Enter}");
		await expect(
			fixture.sent.filter((request) => request.type === "remove"),
		).toHaveLength(1);
		await expect(canvas.getAllByRole("article")).toHaveLength(2);
		await waitFor(() =>
			expect(
				within(canvas.getAllByRole("article")[1]!).getByRole("button", {
					name: "信頼する",
				}),
			).toHaveFocus(),
		);
	},
};

/** 最後の記録を削除した場合は、残っている検索欄へフォーカスを戻す。 */
export const KeyboardLastRemoval: Story = {
	args: { manual: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const user = userEvent.setup({ document: canvasElement.ownerDocument });
		const fixture = canvasElement.querySelector<
			HTMLElement & {
				sent: TrustRequest[];
				emit: (reply: TrustReply) => void;
			}
		>("[data-story-trust]")!;
		fixture.emit({
			type: "state",
			backend: "pi",
			revision: 1,
			requestId: fixture.sent.at(-1)?.requestId,
			records: [
				{
					root: "projects/last",
					trust: "untrusted",
					origin: "workspace",
					updatedAt: null,
				},
			],
			error: null,
		});
		const remove = await canvas.findByRole("button", {
			name: /projects\/last.*削除/,
		});
		remove.focus();
		await user.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(fixture.sent.at(-1)).toMatchObject({
					type: "remove",
					root: "projects/last",
					backend: "pi",
				}),
			{ timeout: 3000 },
		);
		fixture.emit({
			type: "state",
			backend: "pi",
			revision: 2,
			requestId: fixture.sent.at(-1)?.requestId,
			records: [],
			error: null,
		});
		await waitFor(() =>
			expect(canvas.getByRole("searchbox")).toHaveFocus(),
		);
		await user.keyboard("{/Enter}");
		await expect(canvas.queryByRole("article")).not.toBeInTheDocument();
	},
};

/** 再読み込み中は古い一覧を非表示にし、失敗時は一覧と件数を表示しない。 */
export const RefreshFailure: Story = {
	args: { backend: "codex", manual: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const fixture = canvasElement.querySelector<
			HTMLElement & {
				sent: TrustRequest[];
				emit: (reply: TrustReply) => void;
			}
		>("[data-story-trust]")!;
		const records = [
			{
				root: "projects/refresh",
				trust: "trusted",
				origin: "workspace",
				updatedAt: null,
			},
		] as const;
		fixture.emit({
			type: "state",
			backend: "codex",
			revision: 1,
			requestId: fixture.sent.at(-1)?.requestId,
			records: [...records],
			error: null,
		});
		await canvas.findByRole("article");
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await expect(canvas.queryByRole("article")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "再読み込み" }),
		).toBeDisabled();
		await expect(fixture.sent.at(-1)).toMatchObject({
			type: "refresh",
			backend: "codex",
		});

		const error = "信頼設定を読み込めませんでした。";
		fixture.emit({
			type: "state",
			backend: "codex",
			revision: 2,
			requestId: fixture.sent.at(-1)?.requestId,
			records: [...records],
			error,
		});
		await expect(await canvas.findByRole("alert")).toHaveTextContent(error);
		await expect(canvas.queryByRole("article")).not.toBeInTheDocument();
		await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "再読み込み" }),
		).toBeEnabled();
	},
};

/** 再読み込みでエラーを消し、同じバックエンドの一覧を取得して表示する。 */
export const RefreshRecovery: Story = {
	...RefreshFailure,
	play: async (context) => {
		await RefreshFailure.play?.(context);
		const canvas = within(context.canvasElement);
		const fixture = context.canvasElement.querySelector<
			HTMLElement & {
				sent: TrustRequest[];
				emit: (reply: TrustReply) => void;
			}
		>("[data-story-trust]")!;
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(fixture.sent.at(-1)).toMatchObject({
			type: "refresh",
			backend: "codex",
		});
		fixture.emit({
			type: "state",
			backend: "codex",
			revision: 3,
			requestId: fixture.sent.at(-1)?.requestId,
			records: [
				{
					root: "projects/recovered",
					trust: "trusted",
					origin: "workspace",
					updatedAt: null,
				},
			],
			error: null,
		});
		await expect(await canvas.findByRole("article")).toHaveTextContent(
			"projects/recovered",
		);
		await expect(
			canvas.getByRole("button", { name: "再読み込み" }),
		).toBeEnabled();
	},
};
