// Storybook の描画と操作を Chromium で検証する。
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

import { playwright } from "@vitest/browser-playwright";

const dirname =
	typeof __dirname !== "undefined"
		? __dirname
		: path.dirname(fileURLToPath(import.meta.url));

// Storybook アドオンからの起動時も、UI パッケージを基準に解決する。
export default defineConfig({
	root: dirname,
	test: {
		projects: [
			{
				extends: true,
				plugins: [
					// 移動後の Storybook 設定からストーリーを収集する。
					storybookTest({
						configDir: path.join(dirname, ".storybook"),
					}),
				],
				test: {
					name: "storybook",
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
