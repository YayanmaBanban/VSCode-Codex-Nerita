// Storybook 起動後、`node tests/scratch/permission-display.cjs` で権限カードの表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** Host の権限値に対応する表示を、既存ストーリーで明暗テーマごとに確認する。 */
async function main() {
	const directory = join(
		"dist/ui-review",
		`permission-display-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 900 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			for (const [story, label, value] of [
				["workspace-write-user", "ワークスペース内に書き込み", "1"],
				["full-access", "フルアクセス", "2"],
			]) {
				await page.goto(
					`http://localhost:6006/iframe.html?id=chat-composer-settings--${story}&viewMode=story&globals=theme:${theme}`,
				);
				await page
					.getByRole("button", { name: "Mode", exact: true })
					.click();
				const slider = page.getByRole("slider", {
					name: "Mode",
					exact: true,
				});
				await expect(slider).toBeVisible();
				await page.screenshot({
					path: join(directory, `${theme}-${story}.png`),
				});
				await expect(slider).toHaveValue(value);
				await expect(slider).toHaveAttribute("aria-valuetext", label);
			}
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
