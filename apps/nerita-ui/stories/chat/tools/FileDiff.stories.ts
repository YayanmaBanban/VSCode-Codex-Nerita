// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { path, oldLines, newLines } from "./FileDiffData";
import FileDiffFileDiffStory from "./FileDiffFileDiffStory.svelte";

oldLines[71] = "/** マスクで内側を抜き、光の軌道を親要素の外周に限定する。 */";
oldLines[91] = "// 枠線を持つマスク要素で overflow を切ると...";
newLines[71] =
	"/** マスクで内側を抜き、親要素の外周に沿って動く光を表示する。 */";
newLines.splice(
	91,
	1,
	"// マスク要素に overflow-hidden を指定すると...",
	"// 外側の要素で光のはみ出しを切り取り...",
);
const meta = {
	title: "Chat/File Diffs",
	component: FileDiffFileDiffStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FileDiffFileDiffStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ranges: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const heading = canvas.getByRole("button", { name: /^Editing files/ });
		await expect(
			within(heading).getByLabelText("9 行追加、7 行削除"),
		).toBeVisible();
		await userEvent.click(heading);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", {
					name: "BorderBeam.tsx (72:73) の作業ツリー差分を開く",
				}),
			).toBeVisible(),
		);
		const diffs = canvasElement.querySelectorAll<HTMLElement>(".tool-diff");
		for (const diff of [diffs[0]!, diffs[1]!]) {
			const view = within(diff);
			await expect(
				view.getByLabelText("1 行追加、1 行削除"),
			).toBeVisible();
			await expect(
				view.getByLabelText("2 行追加、1 行削除"),
			).toBeVisible();
			await expect(diff).toHaveTextContent(/72\s+- \/\*\*/);
			await expect(diff).toHaveTextContent(/72\s+\+ \/\*\*/);
			await expect(diff).toHaveTextContent(/93\s+\+ \/\/ 外側/);
		}
		await expect(within(diffs[2]!).getByText("(1:3)")).toBeVisible();
		await expect(within(diffs[3]!).getByText("(10:12)")).toBeVisible();
		await expect(diffs[4]).toHaveTextContent(/10\s+- old/);
		await expect(diffs[4]).toHaveTextContent(/15\s+\+ new/);
		await expect(diffs[4]).toHaveTextContent(/16\s+context/);
		const button = canvas.getByRole("button", {
			name: "BorderBeam.tsx (72:73) の作業ツリー差分を開く",
		});
		await userEvent.hover(button);
		await expect(
			await within(document.body).findByRole("tooltip"),
		).toHaveTextContent(`/workspace/project/${path}`);
		await userEvent.click(button);
		const sent: unknown = JSON.parse(
			canvas.getByRole("status").textContent,
		);
		if (!isUiMessage(sent)) {
			throw new Error("送信した要求の形式が不正です。");
		}
		await expect(sent.type).toBe("diff/open");
		if (sent.type === "diff/open") {
			await expect(sent.path).toBe(`/workspace/project/${path}`);
		}
	},
};

/** 長い新規ファイルを縦横にスクロールしても、ファイル操作と変更件数を表示し続ける。 */
export const LongNewFile: Story = {
	args: { scenario: "long" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const heading = canvas.getByRole("button", {
			name: /^長い新規ファイル/,
		});
		await expect(
			within(heading).getByLabelText("180 行追加、0 行削除"),
		).toBeVisible();
		await userEvent.click(heading);
		const code = await canvas.findByRole("region", {
			name: "1:181 の差分コード",
		});
		await waitFor(async () => {
			const rect = code.getBoundingClientRect();
			await expect(rect.height).toBeGreaterThan(0);
			await expect(rect.height).toBeLessThanOrEqual(400);
			await expect(code.scrollHeight).toBeGreaterThan(code.clientHeight);
			await expect(code.scrollWidth).toBeGreaterThan(code.clientWidth);
		});
		code.scrollTo({
			top: code.scrollHeight,
			left: 40,
			behavior: "instant",
		});
		await waitFor(() => expect(code.scrollTop).toBeGreaterThan(0));
		await waitFor(() => expect(code.scrollLeft).toBeGreaterThan(0));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", {
					name: /\(1:181\) の作業ツリー差分を開く/,
				}),
			).toBeVisible(),
		);
	},
};

/** 空ファイル・変更なし・解析できない本文にも、無効なファイルボタンを残す。 */
export const Fallbacks: Story = {
	args: { scenario: "fallback" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: /^Editing files/ }),
		);
		for (const name of ["empty.ts", "unchanged.ts", "unparsed.ts"]) {
			await expect(
				await canvas.findByRole("button", {
					name: `${name} の作業ツリー差分を開く`,
				}),
			).toBeDisabled();
		}
		await waitFor(() =>
			expect(canvas.getByText("空のファイルを作成")).toBeVisible(),
		);
		await expect(canvas.getByText("変更はありません。")).toBeVisible();
		await expect(canvas.getByText("解析できない差分の本文")).toBeVisible();
	},
};
