// 通常の検証から分離し、明示したスクラッチ UI ケースを Chrome で実行する。
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
	testDir: __dirname,
	testMatch: "**/*.spec.cjs",
	outputDir: path.resolve(
		__dirname,
		`../../dist/ui-review/scratch-${process.env.SCRATCH_RUN_ID ?? Date.now()}`,
	),
	fullyParallel: true,
	workers: 1,
	timeout: 120000,
	retries: 0,
	forbidOnly: true,
	reporter: "list",
	use: { browserName: "chromium", channel: "chrome" },
});
