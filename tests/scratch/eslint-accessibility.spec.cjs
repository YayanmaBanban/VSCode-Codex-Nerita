// 実行: pnpm test:scratch eslint-accessibility.spec.cjs --grep "ケース名"
const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 実コンポーネントの描画とページエラーを記録し、変更前後の比較画像を残す。 */
async function runCase(browser, testInfo, { theme, story }) {
	const stage = process.env.SCRATCH_PHASE ?? "after";
	assert.ok(["before", "after"].includes(stage));
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];
	{
		const page = await browser.newPage({
			viewport: { width: 320, height: 800 },
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await page.goto(
			`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
		);
		await page.locator("#storybook-root button").first().waitFor();
		await page.evaluate(() => globalThis.document.fonts.ready);
		await page.screenshot({
			path: `${directory}/${story}-${theme}.png`,
			fullPage: true,
		});

		assert.deepEqual(errors, []);
		await writeFile(
			`${directory}/errors.json`,
			JSON.stringify(errors, null, 2),
		);
		console.log(directory);
	}
}

/** 利用者が開いた画面のフォーカスと、入力・ボタンからの Escape を確認する。 */
async function verifyKeyboard(page, directory) {
	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-sessions--history&viewMode=story",
	);
	await page
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	await page
		.getByRole("button", {
			name: "セッション一覧と履歴の読み込みを実装の名前を変更",
			exact: true,
		})
		.click();
	const name = page.getByRole("textbox", { name: "新しいセッション名" });
	await expect(name).toBeFocused();
	await page.screenshot({ path: `${directory}/rename-focused.png` });
	await name.press("Escape");
	await expect(name).not.toBeVisible();
	await page
		.getByRole("button", {
			name: "セッション一覧と履歴の読み込みを実装の名前を変更",
			exact: true,
		})
		.click();
	await page
		.getByRole("button", { name: "保存", exact: true })
		.press("Escape");
	await expect(name).not.toBeVisible();

	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-search--ready&viewMode=story",
	);
	await page.getByRole("textbox", { name: "Codexへのメッセージ" }).waitFor();
	await page.keyboard.press("Control+f");
	await expect(
		page.getByRole("textbox", { name: "会話を検索" }),
	).toBeFocused();
	await page
		.getByRole("button", { name: "大文字と小文字を区別" })
		.press("Escape");
	await expect(
		page.getByRole("search", { name: "会話内検索" }),
	).not.toBeVisible();

	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-agents--viewer&viewMode=story",
	);
	await page
		.getByRole("button", { name: /^swift-cheetahの会話を表示/ })
		.click();
	await expect(
		page.getByRole("button", { name: "親へ戻る", exact: true }),
	).toBeFocused();
	await page.screenshot({ path: `${directory}/agent-focused.png` });
}

for (const theme of ["dark2026", "light"]) {
	for (const story of [
		"chat-permission--long-command",
		"pi-guardrails--editor",
		"chat-piautheditor--providers",
		"chat-sessions--history",
	]) {
		test(`eslint-accessibility ${theme} ${typeof story === "string" ? story : story.id} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, story });
		});
	}
}

test("キーボード: フォーカスと Escape @behavior", async ({
	reviewBrowser: browser,
}, testInfo) => {
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });
	const page = await browser.newPage({
		viewport: { width: 320, height: 800 },
	});
	await verifyKeyboard(page, directory);
});
