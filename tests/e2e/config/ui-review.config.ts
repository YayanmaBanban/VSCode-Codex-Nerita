// Playwright の実行条件と、ルートを汚さない成果物の保存先を定義する。
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const port = Number(process.env.STORYBOOK_PORT ?? 6007);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "../ui-review",
	outputDir: path.join(repoRoot, "dist/ui-review/test-results"),
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : 2,
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
		baseURL,
		trace: "on",
		video: "on",
		screenshot: "on",
	},
	// 開発サーバーの再読込を避け、今回ビルドした Storybook だけを検証する。
	webServer: {
		command: `pnpm build-storybook && pnpm exec vite preview --outDir dist/storybook --host 127.0.0.1 --port ${port} --strictPort`,
		cwd: repoRoot,
		url: `${baseURL}/index.json`,
		reuseExistingServer: false,
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
