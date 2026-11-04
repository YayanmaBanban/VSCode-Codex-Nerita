// 末尾追従中のちらつきと手動スクロールを撮影・検証する。
// 実行: pnpm test:scratch streaming-scroll.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");

/** 検証ごとに保存先を分け、明暗テーマの結果と実行時エラーを保存する。 */
async function runCase(browser, testInfo, { theme, scenario }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const results = [],
		errors = [];
	try {
		results.push(
			await reviewTheme(
				browser,
				theme,
				phase,
				directory,
				errors,
				scenario,
			),
		);

		expect(errors).toEqual([]);
	} finally {
		await writeFile(
			`${directory}/results.json`,
			JSON.stringify({ results, errors }, null, 2),
		);
		console.log({ directory, results, errors });
	}
}

/** 本文の更新と手動のスクロールを、同じ実コンポーネントで順に確認する。 */
async function reviewTheme(browser, theme, phase, directory, errors, scenario) {
	const page = await browser.newPage({
		viewport: { width: 360, height: 640 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-scroll-follow--updates&viewMode=story&globals=theme:${theme}`,
		);
		const conversation = page.getByRole("region", {
			name: "会話",
			exact: true,
		});
		const jump = page.getByRole("button", {
			name: "メッセージの末尾へ移動",
			exact: true,
		});
		const distance = () =>
			conversation.evaluate(
				(root) =>
					root.scrollHeight - root.clientHeight - root.scrollTop,
			);
		await expect(conversation).toBeVisible({ timeout: 30000 });
		await expect.poll(distance).toBeLessThan(5);
		await expect(jump).toHaveCount(0);
		await page.screenshot({ path: `${directory}/${theme}-before.png` });
		await conversation.evaluate(monitorJumpButton);
		if (scenario === "末尾追従") {
			await reviewFollowing(page, conversation, distance);
		}
		const appearances = await page.evaluate(() => {
			globalThis.jumpObserver.disconnect();
			return globalThis.jumpAppearances;
		});
		await page.screenshot({ path: `${directory}/${theme}-following.png` });
		if (phase === "after" && scenario === "末尾追従") {
			expect(appearances).toBe(0);
		}
		if (scenario === "過去の閲覧位置") {
			await reviewReading(
				page,
				conversation,
				jump,
				distance,
				directory,
				theme,
			);
		}
		return { theme, appearances };
	} catch (error) {
		await page.screenshot({ path: `${directory}/${theme}-failed.png` });
		throw error;
	} finally {
		await page.close();
	}
}

/** 本文追加、仮想行の高さ補正、途中の Markdown の配信を末尾追従中に行う。 */
async function reviewFollowing(page, conversation, distance) {
	const append = page.getByRole("button", {
		name: "本文を追記",
		exact: true,
	});
	for (let index = 0; index < 8; index++) {
		await append.click();
		await expect.poll(distance).toBeLessThan(5);
	}
	await conversation.evaluate(correctAfterGrowth);
	await append.click();
	await expect
		.poll(() => page.evaluate(() => globalThis.layoutCorrected))
		.toBe(true);
	await expect.poll(distance).toBeLessThan(5);
	const receive = page.getByRole("button", {
		name: "マークダウンを受信",
		exact: true,
	});
	await receive.click();
	await expect(
		page.getByText("配信が完了しました。", { exact: true }),
	).toBeVisible();
	await expect(receive).toBeEnabled();
	await expect.poll(distance).toBeLessThan(5);
}

/** 過去の閲覧位置が更新で動かず、キーボードによる末尾復帰後はボタンが消えることを確認する。 */
async function reviewReading(
	page,
	conversation,
	jump,
	distance,
	directory,
	theme,
) {
	await conversation.hover();
	await page.mouse.wheel(0, -500);
	await expect(jump).toBeVisible();
	await page.screenshot({ path: `${directory}/${theme}-reading.png` });
	const top = await conversation.evaluate((root) => root.scrollTop);
	await page.getByRole("button", { name: "本文を追記", exact: true }).click();
	await expect
		.poll(() => conversation.evaluate((root) => root.scrollTop))
		.toBe(top);
	await jump.focus();
	await jump.press("Enter");
	await expect.poll(distance).toBeLessThan(5);
	await expect(jump).toHaveCount(0);
	await page.screenshot({ path: `${directory}/${theme}-returned.png` });
}

/** 最終状態だけでは見逃す、受信中に一瞬追加されたボタンをブラウザー側で数える。 */
function monitorJumpButton(root) {
	globalThis.jumpAppearances = 0;
	const selector = 'button[aria-label="メッセージの末尾へ移動"]';
	globalThis.jumpObserver = new globalThis.MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (
					node instanceof globalThis.Element &&
					(node.matches(selector) || node.querySelector(selector))
				) {
					globalThis.jumpAppearances++;
				}
			}
		}
	});
	globalThis.jumpObserver.observe(root.parentElement, {
		childList: true,
		subtree: true,
	});
}

/** 既存の `LayoutCorrection` と同様に、高さの更新とブラウザーの `scrollTop` 補正を再現する。 */
function correctAfterGrowth(root) {
	const height = root.scrollHeight,
		top = root.scrollTop;
	globalThis.layoutCorrected = false;
	const observer = new globalThis.MutationObserver(() => {
		if (root.scrollHeight <= height) {
			return;
		}
		observer.disconnect();
		root.scrollTop = top - 40;
		globalThis.layoutCorrected = true;
	});
	observer.observe(root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["style"],
	});
}
for (const scenario of ["末尾追従", "過去の閲覧位置"]) {
	for (const theme of ["dark2026", "light"]) {
		test(`ストリーミングスクロール: ${scenario} ${theme} @behavior`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, scenario });
		});
	}
}
