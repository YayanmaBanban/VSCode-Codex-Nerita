// ケースの選択実行: pnpm test:scratch file-diff-review.spec.cjs --grep "差分リンク"
const { expect } = require("@playwright/test");
const { test, waitForStory } = require("../support/scratch-test.cjs");
const { mkdir } = require("node:fs/promises");
const { join } = require("node:path");

for (const theme of ["dark2026", "light"]) {
	for (const width of [420, 320]) {
		for (const scenario of ["差分プレビュー", "差分リンク"]) {
			test(`ファイル差分: ${scenario} ${theme} ${width} @visual @behavior`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				const directory = testInfo.outputPath("review");
				await mkdir(directory, { recursive: true });
				const page = await browser.newPage({
					viewport: { width, height: 900 },
				});
				if (scenario === "差分プレビュー") {
					await page.goto(
						`http://localhost:6006/iframe.html?id=chat-tool-cards--running&viewMode=story&globals=theme:${theme}`,
					);
					await page
						.getByRole("button", { name: /^Editing files/ })
						.click();
					await expect(
						page.locator(".file-diff-lines"),
					).toBeVisible();
					await page.screenshot({
						path: join(directory, `${theme}-${width}.png`),
						animations: "disabled",
					});
				} else {
					await page.goto(
						`http://localhost:6006/iframe.html?id=chat-file-diffs--ranges&viewMode=story&globals=theme:${theme}`,
					);
					// play が同じボタンをクリックし終えてから、独立したホバー操作を開始する。
					await waitForStory(page);
					const button = page
						.getByRole("button", {
							name: "BorderBeam.tsx (72:73) の作業ツリー差分を開く",
							exact: true,
						})
						.first();
					await expect(button).toBeVisible();
					await page.mouse.move(0, 0);
					await button.hover();
					await expect(page.getByRole("tooltip")).toContainText(
						"apps/nerita-ui/src/ui/BorderBeam.tsx",
					);
					await page.screenshot({
						path: join(directory, `${theme}-${width}-tooltip.png`),
						animations: "disabled",
					});
					await button.focus();
					await button.press("Enter");
					await expect(page.getByRole("status")).toContainText(
						'"type":"diff/open"',
					);
					await page.mouse.move(0, 0);
					await page.screenshot({
						path: join(directory, `${theme}-${width}-ranges.png`),
						animations: "disabled",
					});
				}
			});
		}
	}
}
