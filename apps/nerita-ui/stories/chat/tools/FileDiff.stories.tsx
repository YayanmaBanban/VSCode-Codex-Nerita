// 実際のツール本文を通し、差分の行番号・集計・ファイルを開く要求を確認する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { UiMessage } from "@nerita/shared/messages";
import { EditingFiles } from "../../../src/chat/tools/ToolContent";
import "../../../src/chat/chat.css";

const path = "apps/nerita-ui/src/ui/BorderBeam.tsx";
const oldLines = Array.from(
	{ length: 100 },
	(_, index) => `// 行 ${index + 1}`,
);
oldLines[71] = "/** マスクで内側を抜き、光の軌道を親要素の外周に限定する。 */";
oldLines[91] = "// 枠線を持つマスク要素で overflow を切ると...";
const newLines = [...oldLines];
newLines[71] =
	"/** マスクで内側を抜き、親要素の外周に沿って動く光を表示する。 */";
newLines.splice(
	91,
	1,
	"// マスク要素に overflow-hidden を指定すると...",
	"// 外側の要素で光のはみ出しを切り取り...",
);

/** フルパス表示と送信内容の確認には、ローカル環境に依存しない作業ディレクトリを使う。 */
function FileDiffStory() {
	const [request, setRequest] = useState<UiMessage>();
	const cwd = new URL("/workspace/project", window.location.href).pathname;
	return (
		<main className="p-4">
			<EditingFiles
				tool={{
					id: "diff",
					title: "Editing files",
					kind: "edit",
					status: "completed",
					paths: [path],
					content: [
						{
							type: "unifiedDiff",
							path,
							diff: "--- a/BorderBeam.tsx\n+++ b/BorderBeam.tsx\n@@ -72 +72 @@\n-/** マスクで内側を抜き、光の軌道を親要素の外周に限定する。 */\n+/** マスクで内側を抜き、親要素の外周に沿って動く光を表示する。 */\n@@ -92 +92,2 @@\n-// 枠線を持つマスク要素で overflow を切ると...\n+// マスク要素に overflow-hidden を指定すると...\n+// 外側の要素で光のはみ出しを切り取り...\n",
						},
						{
							type: "diff",
							path,
							oldText: oldLines.join("\n"),
							newText: newLines.join("\n"),
						},
						{
							type: "unifiedDiff",
							path: "added.ts",
							diff: "@@ -0,0 +1,2 @@\n+first\n+second\n",
						},
						{
							type: "unifiedDiff",
							path: "deleted.ts",
							diff: "@@ -10,2 +9,0 @@\n-first\n-second\n",
						},
						{
							type: "unifiedDiff",
							path: "shifted.ts",
							diff: "@@ -10,2 +15,2 @@\n-old\n+new\n context\n\\ No newline at end of file\n",
						},
					],
				}}
				cwd={cwd}
				send={setRequest}
			/>
			<output
				aria-label="送信した要求"
				className="block [overflow-wrap:anywhere]"
			>
				{request && JSON.stringify(request)}
			</output>
		</main>
	);
}

const meta = {
	title: "Chat/File Diffs",
	component: FileDiffStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FileDiffStory>;
export default meta;
type Story = StoryObj<typeof meta>;

/** `UnifiedDiff` と `FileDiff` の変更行数が一致し、削除・追加で変更前後それぞれの行番号を使うことを確認する。 */
export const Ranges: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const diffs = canvasElement.querySelectorAll(".tool-diff");
		for (const diff of [diffs[0]!, diffs[1]!]) {
			const view = within(diff as HTMLElement);
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
		await expect(
			within(diffs[2]! as HTMLElement).getByText("L1–3"),
		).toBeVisible();
		await expect(
			within(diffs[3]! as HTMLElement).getByText("L10–12"),
		).toBeVisible();
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
		const sent = JSON.parse(
			canvas.getByRole("status").textContent,
		) as UiMessage;
		await expect(sent.type).toBe("diff/open");
		if (sent.type === "diff/open") {
			await expect(sent.path).toBe(`/workspace/project/${path}`);
		}
	},
};
