// Storybook 起動後、`node tests/scratch/file-diff-review.cjs before` または `after` で差分の表示を撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/** 明暗テーマとサイドバー幅を揃え、差分表示と通信要求を確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`file-diff-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const { theme, width } of [
			{ theme: "dark2026", width: 420 },
			{ theme: "dark2026", width: 320 },
			{ theme: "light", width: 420 },
			{ theme: "light", width: 320 },
		]) {
			const page = await browser.newPage({
				viewport: { width, height: 900 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-tool-cards--running&viewMode=story&globals=theme:${theme}`,
			);
			await page.getByRole("button", { name: /^Editing files/ }).click();
			await expect(page.locator(".file-diff-lines")).toBeVisible();
			await page.screenshot({
				path: join(directory, `${theme}-${width}.png`),
				animations: "disabled",
			});
			if (phase === "after") {
				await page.goto(
					`http://localhost:6006/iframe.html?id=chat-file-diffs--ranges&viewMode=story&globals=theme:${theme}`,
				);
				const button = page
					.getByRole("button", {
						name: "BorderBeam.tsx の作業ツリー差分を開く",
						exact: true,
					})
					.first();
				await expect(button).toBeVisible();
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

/** 変更前の撮影には `HEAD` の表示を使い、撮影後は保存しておいた作業内容を復元する。 */
async function capture() {
	if (process.argv[2] !== "before") {
		await main();
		return;
	}
	const files = [
		"apps/nerita-ui/src/chat/tools/FileDiff.tsx",
		"apps/nerita-ui/src/chat/tools/UnifiedDiff.tsx",
	];
	const originals = await Promise.all(files.map((file) => readFile(file)));
	try {
		for (const file of files) {
			await writeFile(
				file,
				execFileSync("git", ["show", `HEAD:${file}`], {
					windowsHide: true,
				}),
			);
		}
		await main();
	} finally {
		for (let index = 0; index < files.length; index++) {
			await writeFile(files[index], originals[index]);
		}
	}
}

capture().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
