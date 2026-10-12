// Storybook の表示対象と、開発・テスト用アドオンを定義する。
import type { StorybookConfig } from "@storybook/svelte-vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { PluginOption } from "vite";
import { storybookDependencies } from "../storybookDependencies.mts";

const config: StorybookConfig = {
	stories: ["../stories/**/*.stories.ts"],
	addons: [
		"@chromatic-com/storybook",
		"@storybook/addon-vitest",
		"@storybook/addon-mcp",
	],
	framework: "@storybook/svelte-vite",
	/** 本体と同じ CSS 入口を Storybook でもコンパイルする。 */
	viteFinal(config) {
		config.resolve = {
			...config.resolve,
			conditions: [
				...(config.resolve?.conditions ?? []),
				"nerita-source",
			],
			dedupe: ["svelte"],
		};
		const plugins = config.plugins ?? [];
		const compiler = plugins.filter(isSveltePlugin);
		const remaining = plugins.filter((plugin) => !isSveltePlugin(plugin));
		// Storybook の props 解析が、Svelte の変換後の JavaScript を読む順にする。
		config.plugins = [
			...(compiler.length === 0
				? svelte({ configFile: false })
				: compiler),
			...remaining,
			tailwindcss(),
		];
		config.optimizeDeps = {
			...config.optimizeDeps,
			include: [
				...(config.optimizeDeps?.include ?? []),
				...storybookDependencies,
			],
		};
		return config;
	},
};
export default config;

/** Vitest 側で設定したコンパイラーと重複させず、開発サーバーにも接続する。 */
function isSveltePlugin(plugin: PluginOption): boolean {
	if (Array.isArray(plugin)) {
		return plugin.some(isSveltePlugin);
	}
	if (typeof plugin !== "object" || plugin === null) {
		return false;
	}
	if (!("name" in plugin)) {
		return false;
	}
	return plugin.name.startsWith("vite-plugin-svelte");
}
