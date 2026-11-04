// 通常の Extension Host で実際の同意画面を操作し、承認前の通信拒否と承認後の取得を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const vscode = require("vscode");

/** 専用プロファイルの VS Code に接続し、成功・失敗の両方でトレースを保存する。 */
async function run() {
	const extension = process.env.NERITA_DISTRIBUTION_TEST_EXTENSION;
	await vscode.extensions.getExtension("nerita-local.nerita").activate();
	const profile = process.env.NERITA_UI_PROFILE;
	const port = (
		await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
	).split("\n")[0];
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const page = browser.contexts()[0].pages()[0];
	await page.context().tracing.start({ screenshots: true, snapshots: true });
	page.setDefaultTimeout(20000);
	const previousPath = process.env.PATH;
	try {
		const empty = path.join(profile, "empty-cli-path");
		await fs.mkdir(empty);
		process.env.PATH = empty;
		await verifyConsent(page, extension);
		console.log(
			"Codex の同意画面: 拒否前の通信なし・承認後の実取得・再利用に成功",
		);
	} finally {
		process.env.PATH = previousPath;
		await page.screenshot({
			path: path.join(process.env.NERITA_UI_ARTIFACTS, "codex-last.png"),
		});
		await page.context().tracing.stop({
			path: path.join(process.env.NERITA_UI_ARTIFACTS, "codex-trace.zip"),
		});
		await browser.close();
	}
}

/** UI の拒否と許可を実際にクリックし、モデル応答を使わず配布資産の取得だけを行う。 */
async function verifyConsent(page, extension) {
	const { resolveCodexExecutable } = require(
		process.env.NERITA_CODEX_RESOLVER_MODULE,
	);
	const release = JSON.parse(
		await fs.readFile(
			path.join(extension, "dist/runtime/codex/version.json"),
			"utf8",
		),
	);
	const storage = path.join(
		process.env.LOCALAPPDATA,
		"Nerita/runtime/codex",
		release.version,
		"win32-x64",
	);
	const fetcher = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = (input, init) => {
		if (input === release.runtime.url) {
			requests++;
		}
		return fetcher(input, init);
	};
	try {
		const declined = assert.rejects(resolveCodexExecutable(extension));
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("button", { name: "ダウンロード", exact: true }),
		).toBeVisible();
		assert.equal(requests, 0);
		await assert.rejects(fs.access(storage), { code: "ENOENT" });
		await page.screenshot({
			path: path.join(
				process.env.NERITA_UI_ARTIFACTS,
				"codex-consent.png",
			),
		});
		await dialog
			.getByRole("button", { name: /^(キャンセル|Cancel)$/ })
			.click();
		await declined;
		assert.equal(requests, 0);
		const accepted = resolveCodexExecutable(extension);
		await dialog
			.getByRole("button", { name: "ダウンロード", exact: true })
			.click();
		const executable = await accepted;
		assert.equal(requests, 1);
		await fs.access(executable);
		assert.equal(await resolveCodexExecutable(extension), executable);
		assert.equal(requests, 1);
	} finally {
		globalThis.fetch = fetcher;
	}
}

module.exports = { run };
