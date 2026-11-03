// Glob の説明を入力欄のフォーカスで表示し、照合方式・明暗・画面幅による表示を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

/** 照合方式を変更しても入力欄でのみ説明が表示され、フォーカス移動と Escape で消えることを確認する。 */
async function reviewHelp(page, root, name) {
	const input = page.getByRole("textbox", {
		name: "相対パス / パターン",
		exact: true,
	});
	const help = page.getByRole("tooltip");
	await expect(help).toBeVisible();
	assert.ok(await input.getAttribute("aria-describedby"));
	await page.keyboard.press("Escape");
	await expect(help).toHaveCount(0);
	for (const match of ["ディレクトリ配下", "Glob"]) {
		await page.getByRole("combobox", { name: "照合", exact: true }).click();
		await page.getByRole("option", { name: match, exact: true }).click();
		await input.focus();
		if (match === "Glob") {
			await expect(help).toBeVisible();
		} else {
			await expect(help).toHaveCount(0);
			await expect(input).toHaveValue(".");
			const picker = page.getByRole("button", {
				name: "ディレクトリの選択",
			});
			await expect(picker).toBeEnabled();
			await picker.hover();
			await expect(page.getByRole("tooltip")).toBeVisible();
			await page.screenshot({
				path: `${root}/${name}-directory-button.png`,
			});
			await picker.click();
			await expect(input).toHaveValue("src/private");
		}
		await page.screenshot({ path: `${root}/${name}-${match}.png` });
	}
	await page.getByRole("textbox", { name: "ID", exact: true }).focus();
	await expect(help).toHaveCount(0);
}

/** 修正前後を同じ入力欄で撮影し、横方向のはみ出しと実行時エラーも確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/pattern-help-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		for (const [theme, width] of [
			["dark2026", 1200],
			["dark2026", 360],
			["light", 1200],
			["light", 360],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=pi-guardrails--editor&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("textbox", {
					name: "相対パス / パターン",
					exact: true,
				})
				.focus();
			const name = `${theme}-${width}`;
			await page.screenshot({ path: `${root}/${name}-focused.png` });
			if (phase === "after") {
				await reviewHelp(page, root, name);
			}
			assert.equal(
				await page.evaluate(
					() =>
						globalThis.document.documentElement.scrollWidth >
						globalThis.innerWidth,
				),
				false,
			);
		}
		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors }, null, 2),
		);
		console.log(root);
	} finally {
		await browser.close();
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
