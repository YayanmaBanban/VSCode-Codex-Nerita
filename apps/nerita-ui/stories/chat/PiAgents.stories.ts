// Pi の並列の子と個別承認を本体の Svelte UI に表示する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PiAgentsStory from "./PiAgentsStory.svelte";

const meta = {
	title: "Chat/Pi Agents",
	component: PiAgentsStory,
	argTypes: { background: { control: "boolean" } },
	parameters: {
		layout: "fullscreen",
		controls: { matchers: { color: /Color$/i } },
	},
} satisfies Meta<typeof PiAgentsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Parallel: Story = {};
export const Background: Story = { args: { background: true } };
