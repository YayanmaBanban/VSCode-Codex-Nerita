// Storybook 起動後、`node tests/scratch/border-beam-scroll.cjs` で外周の光による横スクロールを検証する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** ブラウザー内で光の位置を固定し、スクロール可能な祖先要素の表示幅と内容幅を取得する。 */
async function measureOverflow(progress) {
	const { document, requestAnimationFrame, getComputedStyle } = globalThis;
	const beam = document.querySelector(
		'[aria-label="承認要求"] [style*="offset-path"]',
	);
	// 検証用 CSS で Motion による位置の更新を上書きし、光の位置を固定する。
	beam.style.setProperty("--review-offset", `${progress * 100}%`);
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const card = document.querySelector('[aria-label="承認要求"]');
	const overflow = [];
	for (let element = card; element; element = element.parentElement) {
		const style = getComputedStyle(element);
		if (
			["auto", "scroll"].includes(style.overflowX) ||
			element === document.documentElement
		) {
			overflow.push({
				element: element.tagName,
				client: element.clientWidth,
				scroll: element.scrollWidth,
			});
		}
	}
	return {
		progress,
		offset: getComputedStyle(beam).offsetDistance,
		overflow,
	};
}

/** 明暗テーマと表示幅を変え、外周上の光を撮影して承認ボタンの表示も確認する。 */
async function reviewPage(browser, directory, theme, width, errors, results) {
	const page = await browser.newPage({ viewport: { width, height: 600 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-app--app-server-permission&viewMode=story&globals=theme:${theme}`,
	);
	await expect(page.getByRole("region", { name: "承認要求" })).toBeVisible();
	await expect(
		page.locator('[aria-label="承認要求"] [style*="offset-path"]'),
	).toBeAttached();
	await page.evaluate(() => globalThis.document.fonts.ready);
	await page.addStyleTag({
		content:
			'[aria-label="承認要求"] [style*="offset-path"] { offset-distance: var(--review-offset) !important; }',
	});

	for (let step = 0; step <= 16; step++) {
		const result = await page.evaluate(measureOverflow, step / 16);
		expect(result.offset).toBe(`${(step / 16) * 100}%`);
		results.push({ theme, width, ...result });
		if (step % 4 === 0) {
			await page.screenshot({
				path: join(directory, `${theme}-${width}-${step}.png`),
			});
		}
		if (step === 6) {
			await verifyBeamVisible(page, directory, `${theme}-${width}`);
		}
	}
	await expect(
		page.getByRole("button", { name: "今回のみ許可" }),
	).toBeVisible();
	await page.close();
}

/** 右辺の光を表示した画像と隠した画像を比較し、スクロール防止の修正で光まで消える不具合を検出する。 */
async function verifyBeamVisible(page, directory, label) {
	const card = page.getByRole("region", { name: "承認要求" });
	const mask = page
		.locator('[aria-label="承認要求"] [style*="offset-path"]')
		.locator("..");
	const visible = await card.screenshot({
		path: join(directory, `${label}-beam-visible.png`),
	});
	await mask.evaluate((element) => {
		element.style.visibility = "hidden";
	});
	const hidden = await card.screenshot({
		path: join(directory, `${label}-beam-hidden.png`),
	});
	await mask.evaluate((element) => {
		element.style.visibility = "";
	});
	expect(visible.equals(hidden), `${label}: 右辺の光が描画されていない`).toBe(
		false,
	);
}

/** 検証結果を保存し、横スクロールの発生と実行時エラーを検出する。 */
async function main() {
	const directory = join("dist/ui-review", `border-beam-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	const results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [420, 743]) {
				await reviewPage(
					browser,
					directory,
					theme,
					width,
					errors,
					results,
				);
			}
		}
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ errors, results }, null, 2),
		);
		console.log(directory);
		expect(errors).toEqual([]);
		for (const result of results) {
			for (const region of result.overflow) {
				expect(
					region.scroll,
					JSON.stringify(result),
				).toBeLessThanOrEqual(region.client);
			}
		}
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
