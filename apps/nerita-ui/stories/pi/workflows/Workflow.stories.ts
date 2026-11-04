// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import WorkflowPreview from "./WorkflowPreview.svelte";
import WorkflowControlsStory from "./WorkflowControlsStory.svelte";

const meta = {
	title: "Pi/Workflow",
	component: WorkflowPreview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const Invalid: Story = { args: { invalid: true } };
export const Loading: Story = { args: { loading: true } };
export const Running: Story = { args: { running: true } };

/** 引数の変更は表示へ反映し、シナリオが同じ間の文書編集は保持する。 */
export const ControlsUpdates: StoryObj<typeof WorkflowControlsStory> = {
	render: () => ({ Component: WorkflowControlsStory }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByLabelText("Workflow グラフ"),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("checkbox", { name: "読み込み待ち" }),
		);
		await waitFor(() =>
			expect(
				canvas.queryByLabelText("Workflow グラフ"),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(
			canvas.getByRole("checkbox", { name: "読み込み待ち" }),
		);
		await expect(
			await canvas.findByLabelText("Workflow グラフ"),
		).toBeVisible();
		await userEvent.click(canvas.getByRole("checkbox", { name: "実行中" }));
		await waitFor(() =>
			expect(canvas.getByRole("button", { name: "停止" })).toBeEnabled(),
		);
		await expect(
			canvas.getByRole("button", { name: "実行" }),
		).toBeDisabled();
		await userEvent.click(canvas.getByRole("checkbox", { name: "実行中" }));
		await waitFor(() =>
			expect(canvas.getByRole("button", { name: "停止" })).toBeDisabled(),
		);
		await userEvent.click(
			canvas.getByRole("checkbox", { name: "不正な定義" }),
		);
		const input = await canvas.findByRole("textbox", {
			name: "Workflow TOML",
		});
		await expect(input).toHaveValue("version = [");
		await userEvent.type(input, "1");
		await waitFor(() =>
			expect(canvas.getByRole("button", { name: "保存" })).toBeEnabled(),
		);
		await expect(input).toHaveValue("version = [1");
		await userEvent.click(canvas.getByRole("button", { name: "保存" }));
		await expect(input).toHaveValue("version = [1");
	},
};
export const SaveError: Story = {
	args: { failure: "save" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "保存" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", {
				name: "文書を再読み込み（入力を破棄）",
			}),
		).toBeEnabled();
	},
};
export const ValidationError: Story = {
	args: { failure: "check" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "検証" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
	},
};

// agent のない定義は、実行条件の検証によって TOML 編集へ切り替わる。
const missingAgent =
	'version=1\nname="Phase25"\noutputs=["review"]\n[[steps]]\nid="review"\ntask="表示検証"\n';
const minimal = missingAgent.replace(
	'id="review"\n',
	'id="review"\nagent="reviewer"\n',
);

export const Minimal: Story = {
	args: { text: minimal },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const graph = await canvas.findByLabelText("Workflow グラフ");
		await waitFor(async () => {
			await expect(within(graph).getByText("review")).toBeVisible();
		});
		await expect(graph.querySelectorAll(".svelte-flow__node")).toHaveLength(
			1,
		);
	},
};

export const MissingAgent: Story = {
	args: { text: missingAgent },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("textbox", { name: "Workflow TOML" }),
		).toHaveValue(missingAgent);
		await expect(
			canvas.queryByLabelText("Workflow グラフ"),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByText("TOML を修正するとグラフ編集を利用できます。"),
		).toBeVisible();
	},
};
