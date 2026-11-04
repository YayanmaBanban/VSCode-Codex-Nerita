// スクラッチ UI 検証のページと成果物をケースごとに隔離し、失敗時も後片付けする。
const { test: base, expect } = require("@playwright/test");
const { writeFile } = require("node:fs/promises");

/** ページごとの設定を受け取り、作成した context をケース終了時にすべて閉じる。 */
const test = base.extend({
	reviewBrowser: async ({ browser }, use, testInfo) => {
		const contexts = [];
		const errors = [];
		const reviewBrowser = {
			async newPage(options = {}) {
				const context = await browser.newContext(options);
				contexts.push(context);
				// Storybook は favicon を配信しないため、ブラウザーの自動要求へ検証用の空応答を返す。
				await context.route("**/favicon.ico", (route) =>
					route.fulfill({ status: 204 }),
				);
				const page = await context.newPage();
				page.on("pageerror", (error) => errors.push(String(error)));
				page.on("console", (message) => {
					if (
						message.type() === "error" ||
						message.text().includes("derived_inert")
					) {
						errors.push(
							`${message.text()} (${message.location().url})`,
						);
					}
				});
				return page;
			},
			newBrowserCDPSession: () => browser.newBrowserCDPSession(),
		};
		try {
			await use(reviewBrowser);
			expect(errors, "ブラウザーの実行時エラー").toEqual([]);
		} finally {
			try {
				await writeFile(
					testInfo.outputPath("browser-errors.json"),
					JSON.stringify(errors, null, 2),
				);
				await captureFailure(contexts, testInfo);
			} finally {
				await Promise.all(contexts.map((context) => context.close()));
			}
		}
	},
});

/** 失敗したケースの開いているページを、ほかのケースと重ならない場所へ保存する。 */
async function captureFailure(contexts, testInfo) {
	if (testInfo.status === testInfo.expectedStatus) {
		return;
	}
	const pages = contexts.flatMap((context) => context.pages());
	for (const [index, page] of pages.entries()) {
		await page
			.screenshot({
				path: testInfo.outputPath(`failure-${index}.png`),
				fullPage: true,
			})
			.catch((error) => {
				console.error("失敗画面を保存できませんでした", error);
			});
	}
}

/** モーダルの外にある Story 専用の受信ボタンから、Host の応答だけを注入する。製品 UI の操作には使わない。 */
async function deliverStoryResponse(page, name) {
	if (!["出力応答を受信", "完了通知を受信"].includes(name)) {
		throw new Error(`未対応の Story 応答です: ${name}`);
	}
	await page
		.getByRole("button", { name, exact: true })
		.evaluate((button) => button.click());
}

/** Story の play を含む描画が完了してから、独立したケースの操作を始める。 */
async function waitForStory(page) {
	await page.waitForFunction(() =>
		globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
			(render) => render.phase === "finished",
		),
	);
}

module.exports = { test, expect, deliverStoryResponse, waitForStory };
