// Storybook のブラウザテストを実行し、生成物を dist 配下に集約する。
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

import { playwright } from "@vitest/browser-playwright";

const dirname =
	typeof __dirname !== "undefined"
		? __dirname
		: path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(dirname, "..");

// Storybook アドオンからの起動時も、リポジトリルートを基準に解決する。
export default defineConfig({
	root: repoRoot,
	test: {
		coverage: {
			reportsDirectory: path.join(repoRoot, "dist/vitest/coverage"),
		},
		projects: [
			{
				extends: true,
				plugins: [
					// 移動後の Storybook 設定から Story を収集する。
					storybookTest({
						configDir: path.join(dirname, "storybook"),
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
