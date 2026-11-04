// Playwright Test ではインストール済み Chrome を使う。
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
	testIgnore: ["**/tests/scratch/**"],
	use: {
		browserName: "chromium",
		channel: "chrome",
	},
});
