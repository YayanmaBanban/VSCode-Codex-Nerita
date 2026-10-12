// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, waitFor, within } from "storybook/test";
import WorkflowPreview from "./WorkflowPreview.svelte";
const meta = {
	title: "Pi/Workflow",
	component: WorkflowPreview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const Invalid: Story = { args: { invalid: true } };

// agent のない定義は、実行条件の検証によって TOML 編集へ切り替わる。
const missingAgent =
	'version=1\nname="Phase25"\noutputs=["review"]\n[[steps]]\nid="review"\ntask="表示検証"\n';
const minimal = missingAgent.replace('id="review"\n', 'id="review"\nagent="reviewer"\n');

export const Minimal: Story = {
	args: { text: minimal },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const graph = await canvas.findByLabelText("Workflow グラフ");
		await waitFor(async () => {
			await expect(within(graph).getByText("review")).toBeVisible();
		});
		await expect(graph.querySelectorAll(".svelte-flow__node")).toHaveLength(1);
	},
};

export const MissingAgent: Story = {
	args: { text: missingAgent },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("textbox", { name: "Workflow TOML" }),
		).toHaveValue(missingAgent);
		await expect(canvas.queryByLabelText("Workflow グラフ")).not.toBeInTheDocument();
		await expect(
			canvas.getByText("TOML を修正するとグラフ編集を利用できます。"),
		).toBeVisible();
	},
};
