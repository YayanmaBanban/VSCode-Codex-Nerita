import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SettingsStory from "./SettingsStory.svelte";

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
	render: () => ({ Component: ProposedPlanStory }),
};
