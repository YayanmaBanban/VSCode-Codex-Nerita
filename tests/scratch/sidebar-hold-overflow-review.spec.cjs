// ツールチップ表示後の短い長押しをフレームごとに観測し、横方向のはみ出しと区切り線を確認する。
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 揺れの途中でも削除を確定せず、スクロール領域の幅を各フレームで記録する。 */
async function sampleHold(page, button) {
	await button.hover();
	await expect(page.getByRole("tooltip")).toBeVisible();
	await page.mouse.down();
	const frames = await page.evaluate(async () => {
		const started = performance.now();
		const samples = [];
		while (performance.now() - started < 450) {
			await new Promise(globalThis.requestAnimationFrame);
			samples.push(
				[
					...globalThis.document.querySelectorAll(
						".sidebar-layout, [aria-label='パスルール一覧'], .guardrails-scroll",
					),
				].map((element) => ({
					name:
						element.getAttribute("aria-label") ?? element.className,
					client: element.clientWidth,
					scroll: element.scrollWidth,
				})),
			);
		}
		return samples;
	});
	await page.mouse.up();
	return frames;
}

/** 同じ画面と操作で修正前後を比較し、結果と画像を実行ごとに保存する。 */
async function runCase(browser, testInfo, { theme }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const results = [];
	{
		const page = await browser.newPage({
			viewport: { width: 1200, height: 950 },
		});
		{
			await page.goto(
				`http://localhost:6006/iframe.html?id=pi-guardrails--editor&viewMode=story&globals=theme:${theme}`,
			);
			const list = page.getByRole("region", { name: "パスルール一覧" });
			await expect(list).toBeVisible();
			const frames = await sampleHold(
				page,
				list.getByRole("button", { name: "パスルール 1を削除" }),
			);
			const overflow = frames
				.flat()
				.filter((frame) => frame.scroll > frame.client);
			const geometry = await page
				.locator(".sidebar-layout")
				.evaluate((element) => ({
					root: element.getBoundingClientRect().toJSON(),
					scroll: element
						.closest(".guardrails-scroll")
						.getBoundingClientRect()
						.toJSON(),
					aside: element
						.querySelector("aside")
						.getBoundingClientRect()
						.toJSON(),
					panel: element
						.querySelector(".sidebar-panel")
						.getBoundingClientRect()
						.toJSON(),
				}));
			await page.screenshot({ path: `${root}/${theme}.png` });
			results.push({ theme, overflow, geometry });
			if (phase === "after") {
				assert.deepEqual(overflow, []);
				assert.ok(
					Math.abs(geometry.aside.top - geometry.scroll.top) < 1,
				);
				assert.ok(
					Math.abs(geometry.aside.bottom - geometry.scroll.bottom) <
						1,
				);
			}
		}
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify(results, null, 2),
		);
		console.log(JSON.stringify({ root, results }));
	}
}

for (const theme of ["dark2026", "light"]) {
	test(`sidebar-hold-overflow-review ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
