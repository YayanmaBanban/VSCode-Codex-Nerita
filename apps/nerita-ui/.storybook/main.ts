// Storybook の表示対象と、開発・テスト用アドオンを定義する。
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
	stories: ["../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		"@chromatic-com/storybook",
		"@storybook/addon-vitest",
		"@storybook/addon-mcp",
	],
	framework: "@storybook/react-vite",
	/** 本体と同じ CSS 入口を Storybook でもコンパイルする。 */
	viteFinal(config) {
		config.resolve = {
			...config.resolve,
			conditions: [
				...(config.resolve?.conditions ?? []),
				"nerita-source",
			],
			dedupe: ["react", "react-dom"],
		};
		config.plugins = [...(config.plugins ?? []), tailwindcss()];
		return config;
	},
};
export default config;
