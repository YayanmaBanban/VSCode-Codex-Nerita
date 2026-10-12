// すべてのストーリーに共通するプレビュー設定を定義する。
import type { Preview } from "@storybook/svelte-vite";
import "./tailwind.css";
import "./theme.css";
import "./dark2026.css";

const preview: Preview = {
	initialGlobals: { theme: "dark2026" },
	globalTypes: {
		theme: {
			description: "プレビューのテーマ",
			toolbar: {
				icon: "paintbrush",
				dynamicTitle: true,
				items: [
					{ value: "default", title: "Default (System)" },
					{ value: "light", title: "Light" },
					{ value: "dark2026", title: "Dark 2026" },
				],
			},
		},
	},
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},

	decorators: [
		(renderStory, context) => {
			applyTheme(context.globals.theme);
			return renderStory();
		},
	],
	/** ストーリーの終了時にテーマ属性を解除する。 */
	beforeEach() {
		return () => {
			delete document.documentElement.dataset.storybookTheme;
		};
	},
};

/** ツールバーのテーマを VS Code と同じ CSS 変数へ接続する。 */
function applyTheme(theme: unknown) {
	if (theme === "light" || theme === "dark2026") {
		document.documentElement.dataset.storybookTheme = theme;
	} else {
		delete document.documentElement.dataset.storybookTheme;
	}
}

export default preview;
