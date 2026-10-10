// Storybook 起動後、`node tests/scratch/empty-conversation-scroll.cjs after` で初回送信と末尾追従を確認する。
// 引数の `before` / `after` は成果物の保存先名に使い、省略時は `after` とする。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマの狭い画面幅で、初回送信、カード追加、過去の閲覧と末尾への復帰を確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`empty-scroll-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const results = [];
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			await reviewTheme(browser, theme, directory, results, errors);
		}
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ results, errors }, null, 2),
		);
		console.log(directory);
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
	}
}

/** 同じ会話でカードを逐次追加・一括追加し、表示範囲を超えても末尾への追従を続けることを確認する。 */
async function reviewTheme(browser, theme, directory, results, errors) {
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
			`http://localhost:6006/iframe.html?id=chat-scroll-follow--empty-updates&viewMode=story&globals=theme:${theme}`,
		);
		const conversation = page.getByRole("region", { name: /^会話$/ });
		await expect(conversation).toBeVisible({ timeout: 30000 });
		await page.getByRole("textbox").fill("作業を進めてください。");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await page.getByRole("button", { name: "送信を受け付ける" }).click();
		await expect(page.getByRole("textbox")).toHaveText("");

		for (let index = 1; index <= 40; index++) {
			await page
				.getByRole("button", { name: "カードを受信", exact: true })
				.click();
			await expect(
				conversation.locator("[data-entry-count]"),
			).toHaveAttribute("data-entry-count", String(index + 1));
			await expect.poll(() => distance(conversation)).toBeLessThan(5);
			await settle(conversation);
			results.push({ theme, index, ...(await position(conversation)) });
		}
		await page.screenshot({ path: join(directory, `${theme}-cards.png`) });
		await page
			.getByRole("button", { name: "カードをまとめて受信" })
			.click();
		await expect(
			conversation.locator("[data-entry-count]"),
		).toHaveAttribute("data-entry-count", "61");
		await expect.poll(() => distance(conversation)).toBeLessThan(5);
		await settle(conversation);
		results.push({
			theme,
			index: "batch",
			...(await position(conversation)),
		});
		await page.screenshot({ path: join(directory, `${theme}-batch.png`) });
		await verifyManualScroll(page, conversation, directory, theme);

		await page.getByRole("button", { name: "回答を受信" }).click();
		await expect.poll(() => distance(conversation)).toBeLessThan(5);
		await settle(conversation);
		results.push({
			theme,
			index: "answer",
			...(await position(conversation)),
		});
		await page.screenshot({ path: join(directory, `${theme}-answer.png`) });
		expect(
			results
				.filter((result) => result.theme === theme)
				.every((result) => result.distance <= 4),
		).toBe(true);
	} catch (error) {
		await page.screenshot({ path: join(directory, `${theme}-failed.png`) });
		throw error;
	} finally {
		await page.close();
	}
}

/** キーボードとホイールで過去を読む間はカード追加で閲覧位置を動かさず、末尾へ戻した後は追従することを確認する。 */
async function verifyManualScroll(page, conversation, directory, theme) {
	const jump = page.getByRole("button", {
		name: "メッセージの末尾へ移動",
		exact: true,
	});
	for (const input of ["keyboard", "wheel"]) {
		if (input === "keyboard") {
			await conversation.focus();
			await page.keyboard.press("PageUp");
		} else {
			await conversation.hover();
			await page.mouse.wheel(0, -500);
		}
		await expect.poll(() => distance(conversation)).toBeGreaterThan(100);
		await settle(conversation);
		const top = await conversation.evaluate((element) => element.scrollTop);
		await page
			.getByRole("button", { name: "カードを受信", exact: true })
			.click();
		await settle(conversation);
		expect(
			await conversation.evaluate((element) => element.scrollTop),
		).toBe(top);
		await expect(jump).toBeVisible();
		await page.screenshot({
			path: join(directory, `${theme}-${input}-reading.png`),
		});
		await jump.click();
		await expect.poll(() => distance(conversation)).toBeLessThan(5);
		await page
			.getByRole("button", { name: "カードを受信", exact: true })
			.click();
		await expect.poll(() => distance(conversation)).toBeLessThan(5);
		await expect(jump).toHaveCount(0);
	}
}

/** 末尾との距離が一時的に一致するだけで成功としないよう、描画・再計測・ブラウザのスクロール処理後のフレームまで待つ。 */
async function settle(conversation) {
	await conversation.evaluate(async (element) => {
		for (let frame = 0; frame < 20; frame++) {
			await new Promise((resolve) =>
				element.ownerDocument.defaultView.requestAnimationFrame(
					resolve,
				),
			);
		}
	});
}

/** 会話の末尾との距離を操作結果として確認する。 */
async function distance(conversation) {
	return (await position(conversation)).distance;
}

/** ビューポートとスクロール位置を成果物へ記録する。 */
async function position(conversation) {
	return conversation.evaluate((element) => ({
		top: element.scrollTop,
		height: element.scrollHeight,
		client: element.clientHeight,
		distance:
			element.scrollHeight - element.clientHeight - element.scrollTop,
	}));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
