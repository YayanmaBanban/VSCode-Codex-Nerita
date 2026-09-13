// Storybook の表示対象と、開発・テスト用アドオンを定義する。
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	stories: ["../../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		"@chromatic-com/storybook",
		"@storybook/addon-vitest",
		"@storybook/addon-mcp",
	],
	framework: "@storybook/react-vite",
};
export default config;
