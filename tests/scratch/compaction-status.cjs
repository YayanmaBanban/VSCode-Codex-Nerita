// Storybook 起動後、`node tests/scratch/compaction-status.cjs before|after` で圧縮カードの開始・完了表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマ・狭幅で圧縮中から完了への表示を撮影する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`compaction-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 320, height: 650 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-activity-tools--all&viewMode=story&globals=theme:${theme}`,
			);
			const card = page
				.locator(".tool-card")
				.filter({ hasText: "コンテキスト圧縮" });
			await expect(card).toBeVisible({ timeout: 30000 });
			if (phase === "after") {
				await expect(
					card.getByRole("img", { name: "実行中" }),
				).toBeVisible();
				await expect(
					card.getByRole("img", { name: "完了" }),
				).toHaveCount(0);
				await expect(card.getByRole("button")).toHaveCount(0);
			}
			await page.screenshot({
				path: join(directory, `${theme}-running.png`),
			});
			await page.getByRole("button", { name: "完了通知を受信" }).click();
			await expect(card.getByRole("img", { name: "完了" })).toBeVisible();
			await expect(card.getByRole("img", { name: "実行中" })).toHaveCount(
				0,
			);
			await page.screenshot({
				path: join(directory, `${theme}-completed.png`),
			});
			await page.close();
		}
		await writeFile(
			join(directory, "errors.json"),
			JSON.stringify(errors, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
