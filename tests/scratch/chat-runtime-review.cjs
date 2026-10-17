// Storybook 起動後に実行し、会話位置と履歴の開閉を明暗テーマ・広狭の画面で確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** ストーリーのアサーション後にも、画面状態とブラウザーの診断を確認する。 */
async function review(page, id, theme, width, directory) {
	await page.setViewportSize({ width, height: 800 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
	);
	await page.waitForFunction(
		() =>
			globalThis.__STORYBOOK_PREVIEW__?.currentRender?.phase ===
			"finished",
	);
	assert.equal(await page.locator(".sb-errordisplay").isVisible(), false, id);
	if (id.startsWith("chat-sessions")) {
		await reviewSessions(page);
	}
	await page.screenshot({
		path: `${directory}/${id}-${theme}-${width}.png`,
		fullPage: true,
	});
	const result = await page.evaluate(() => {
		const root = globalThis.document.documentElement;
		const conversation = globalThis.document.querySelector(".conversation");
		return {
			viewport: root.clientWidth,
			scrollWidth: root.scrollWidth,
			background: globalThis.getComputedStyle(globalThis.document.body)
				.backgroundColor,
			foreground: globalThis.getComputedStyle(globalThis.document.body)
				.color,
			rows: conversation?.querySelectorAll("[data-entry-key]").length,
			scrollTop: conversation?.scrollTop,
		};
	});
	assert.ok(result.scrollWidth <= result.viewport, `${id}: 横スクロール`);
	if (id.startsWith("chat-virtualization")) {
		assert.ok(result.rows > 0 && result.rows < 40, `${id}: 仮想行数`);
	}
	if (id === "chat-virtualization--search-and-expansion") {
		assert.equal(
			await page
				.getByRole("button", { name: /^冒頭ツール/, expanded: true })
				.count(),
			1,
			"検索後に開いた冒頭ツールが表示範囲に残る",
		);
	}
	return { id, theme, width, ...result };
}

/** 自動テストが閉じた履歴を開き直し、説明表示後にも閉じてフォーカスが戻ることを確認する。 */
async function reviewSessions(page) {
	const toggle = page.getByRole("button", {
		name: "セッション一覧",
		exact: true,
	});
	await toggle.click();
	const close = page.getByRole("button", { name: "セッション一覧を閉じる" });
	await page.waitForFunction(
		() =>
			globalThis.document.activeElement?.getAttribute("aria-label") ===
			"セッション一覧を閉じる",
	);
	await page.getByRole("tooltip", { name: "閉じる", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	await page.getByRole("complementary", { name: "セッション一覧" }).waitFor({
		state: "detached",
	});
	assert.equal(
		await toggle.evaluate(
			(node) => node === globalThis.document.activeElement,
		),
		true,
	);
	assert.equal(await close.count(), 0);
	await toggle.click();
	await page.waitForFunction(
		() =>
			globalThis.document.activeElement?.getAttribute("aria-label") ===
			"セッション一覧を閉じる",
	);
}

/** 前のケースのポインター位置やフォーカスを持ち越さず、失敗した画面も保存する。 */
async function reviewCase(browser, id, theme, width, directory, diagnostics) {
	const page = await browser.newPage();
	page.setDefaultTimeout(15000);
	page.setDefaultNavigationTimeout(60000);
	page.on("pageerror", (error) => diagnostics.push(String(error)));
	page.on("console", (message) => {
		if (["warning", "error"].includes(message.type())) {
			diagnostics.push(message.text());
		}
	});
	try {
		return await review(page, id, theme, width, directory);
	} catch (error) {
		await page.screenshot({
			path: `${directory}/failure-${id}-${theme}-${width}.png`,
		});
		throw error;
	} finally {
		await page.close();
	}
}

/** エラーを隠さず収集し、画像と表示値を今回の成果物へ保存する。 */
async function main() {
	const directory = `dist/ui-review/chat-runtime-${Date.now()}`;
	await fs.mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const diagnostics = [];
	const results = [];
	try {
		for (const id of [
			"chat-virtualization--restore-and-append",
			"chat-virtualization--search-and-expansion",
			"chat-agents--viewer",
			"chat-sessions--opening-without-horizontal-scroll",
			"chat-sessions--closing-with-tooltip",
		]) {
			for (const [theme, width] of [
				["dark2026", 420],
				["dark2026", 1280],
				["light", 420],
				["light", 1280],
			]) {
				results.push(
					await reviewCase(
						browser,
						id,
						theme,
						width,
						directory,
						diagnostics,
					),
				);
			}
		}
		assert.deepEqual(diagnostics, []);
		console.log(directory);
	} finally {
		await fs.writeFile(
			`${directory}/results.json`,
			JSON.stringify({ results, diagnostics }, null, 2),
		);
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
