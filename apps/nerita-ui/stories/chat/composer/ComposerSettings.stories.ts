// 設定の表示状態と、Host の確定応答を待つ操作を検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import SettingsStory from "./SettingsStory.svelte";
import { storyBridge } from "../storyBridgeElement";
import { settingsFixture } from "../fixtures/settingsFixture";

import ProposedPlanStory from "./ProposedPlanStory.svelte";

const meta = {
	title: "Chat/Composer Settings",
	component: SettingsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsStory>;

export default meta;

/** 操作と通知の競合を再現するストーリー。 */
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

/** 選択値を送信し、保存中は再操作を止め、Host の応答後に表示へ反映する。 */
export const ConfigurationPending: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const bridge = storyBridge(canvasElement);
		const input = await canvas.findByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await userEvent.type(input, "設定変更中も残す下書き");
		const model = canvas.getByRole("button", {
			name: "モデルと推論レベル",
		});
		await userEvent.click(model);
		await userEvent.click(page.getByRole("combobox", { name: "Model" }));
		await userEvent.click(page.getByRole("option", { name: "5.6 Luna" }));
		const requests = bridge.sent.filter(
			(message) => message.type === "config/set",
		);
		await expect(requests).toHaveLength(1);
		await expect(requests[0]).toMatchObject({
			configId: "model",
			value: "gpt-5.6-luna",
		});
		await expect(model).toHaveTextContent("6 Astra");

		bridge.patchState({ configPending: true });
		await waitFor(() => expect(model).toBeDisabled());
		await expect(
			canvas.getByRole("button", { name: "送信" }),
		).toBeDisabled();
		bridge.patchState({
			configPending: false,
			configOptions: settingsFixture().map((option) =>
				option.id === "model"
					? { ...option, currentValue: "gpt-5.6-luna" }
					: option,
			),
		});
		await waitFor(() => expect(model).toHaveTextContent("5.6 Luna"));
		await expect(model).toBeEnabled();
		await expect(
			canvas.getByRole("button", { name: "送信" }),
		).toBeEnabled();
		await expect(input).toHaveTextContent("設定変更中も残す下書き");
		// 次の見本へポップアップやツールチップを持ち越さない。
		if (model.getAttribute("aria-expanded") === "true") {
			await userEvent.click(model);
		}
		await userEvent.unhover(model);
	},
};

/** 権限と承認者を固定し、カードを開いて見た目を比較する。 */
export const ReadOnly: Story = { args: { mode: "read-only" } };

export const WorkspaceWriteUser: Story = {
	args: { mode: "workspace-write", reviewer: "user" },
};

export const WorkspaceWriteAutoReview: Story = {
	args: { mode: "workspace-write", reviewer: "auto_review" },
};

export const FullAccess: Story = { args: { mode: "danger-full-access" } };

export const ProposedPlan: Story = {
	render: () => ({ Component: ProposedPlanStory, props: {} }),
};
