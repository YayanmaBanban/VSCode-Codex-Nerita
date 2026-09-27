// すべてのストーリーに共通するプレビュー設定を定義する。
import type { Preview } from "@storybook/react-vite";
import { useEffect } from "react";
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
			const theme: unknown = context.globals.theme;

			useEffect(() => {
				const root = document.documentElement;
				if (theme === "light" || theme === "dark2026") {
					root.dataset.storybookTheme = theme;
				} else {
					delete root.dataset.storybookTheme;
				}

				return () => {
					delete root.dataset.storybookTheme;
				};
			}, [theme]);

			return renderStory();
		},
	],
};

export default preview;
