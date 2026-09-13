// すべての Story に共通するプレビュー設定を定義する。
import type { Preview } from "@storybook/react-vite";
import "./theme.css";

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},
};

export default preview;
