// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within } from "storybook/test";
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
type Story = StoryObj<Record<string, never>>;
export const Ranges: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const diffs = canvasElement.querySelectorAll<HTMLElement>(".tool-diff");
		for (const diff of [diffs[0]!, diffs[1]!]) {
			const view = within(diff);
			await expect(
				view.getByLabelText("3 行追加、2 行削除"),
			).toBeVisible();
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
		await expect(within(diffs[2]!).getByText("L1–3")).toBeVisible();
		await expect(within(diffs[3]!).getByText("L10–12")).toBeVisible();
		await expect(diffs[4]).toHaveTextContent(/10\s+- old/);
		await expect(diffs[4]).toHaveTextContent(/15\s+\+ new/);
		await expect(diffs[4]).toHaveTextContent(/16\s+context/);
		const button = canvas.getAllByRole("button", {
			name: "BorderBeam.tsx の作業ツリー差分を開く",
		})[0]!;
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
