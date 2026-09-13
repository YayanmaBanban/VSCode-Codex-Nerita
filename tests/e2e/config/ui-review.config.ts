// Playwright の実行条件と、ルートを汚さない成果物の保存先を定義する。
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
	testDir: "../ui-review",
	outputDir: path.join(repoRoot, "dist/ui-review/test-results"),
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	// HTML レポートはテスト成果物とは別に出力先を指定する。
	reporter: [
		["list"],
		[
			"html",
			{
				outputFolder: path.join(repoRoot, "dist/ui-review/report"),
				open: "never",
			},
		],
	],
	use: {
		baseURL: "http://127.0.0.1:6006",
		trace: "on",
		video: "on",
		screenshot: "on",
	},
	// 起動位置を固定し、CI では既存サーバーを再利用しない。
	webServer: {
		command: "pnpm storybook --host 127.0.0.1 --exact-port --ci",
		cwd: repoRoot,
		url: "http://127.0.0.1:6006/index.json",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 420, height: 820 },
				colorScheme: "dark",
			},
		},
	],
});
