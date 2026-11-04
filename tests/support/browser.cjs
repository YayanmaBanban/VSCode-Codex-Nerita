// UI の検証では、自動更新されるインストール済み Chrome を起動する。
const { chromium } = require("playwright");

/**
 * 同梱 Chromium へ切り替えずに起動する。呼び出し側は finally で browser.close() を待つ。
 * @param {import("playwright").LaunchOptions} options headless や起動引数など、検証ごとの条件。
 */
function launchBrowser(options = {}) {
	return chromium.launch({ ...options, channel: "chrome" });
}

module.exports = { launchBrowser };
