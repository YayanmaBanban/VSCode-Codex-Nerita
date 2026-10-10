// Storybook 起動後、`node tests/scratch/tooltip-length.cjs` で長文の省略表示を確認する。
// 変更前の比較画像を保存する場合は、変更前の実装で末尾に `--before` を指定する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマの狭い画面幅で、省略表示と画面からのはみ出し、カード展開後の全文表示を確認する。 */
async function main() {
	const before = process.argv.includes("--before");
	const directory = join("dist/ui-review", `tooltip-length-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	const results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 420]) {
				const page = await browser.newPage({
					viewport: { width, height: 550 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") {
						errors.push(message.text());
					}
				});
				await page.goto(
					`http://localhost:6006/iframe.html?id=chat-tool-cards--long-command-tooltip&viewMode=story&globals=theme:${theme}`,
				);
				const heading = page.locator(".tool-heading");
				await heading.hover();
				const tooltip = page.getByRole("tooltip");
				await expect(tooltip).toBeVisible();
				const result = await tooltip.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const document = element.ownerDocument;
					const style =
						document.defaultView.getComputedStyle(element);
					return {
						text: element.textContent,
						height: bounds.height,
						bottom: bounds.bottom,
						scrollHeight: document.documentElement.scrollHeight,
						scrollWidth: document.documentElement.scrollWidth,
						background: style.backgroundColor,
						color: style.color,
					};
				});
				results.push({ theme, width, before, ...result });
				await page.screenshot({
					path: join(directory, `${theme}-${width}.png`),
					animations: "disabled",
				});
				await verifyResult(page, result, width, before);
				await page.close();
			}
		}
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ errors, results }, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** 修正後は、ツールチップが画面内に収まり、カードを展開するとコマンド全文が表示されることを検証する。 */
async function verifyResult(page, result, width, before) {
	if (before) {
		return;
	}
	expect(result.text).toHaveLength(301);
	expect(result.text.endsWith("…")).toBe(true);
	expect(result.scrollHeight).toBeLessThanOrEqual(550);
	expect(result.scrollWidth).toBeLessThanOrEqual(width);
	expect(result.bottom).toBeLessThanOrEqual(550);
	await page.locator(".tool-heading").press("Enter");
	await expect(page.locator(".tool-command")).toHaveText(
		`rtk proxy powershell -NoProfile -EncodedCommand ${"JABQ".repeat(400)}`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
