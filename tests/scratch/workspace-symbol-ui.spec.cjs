// シンボルの検索結果・失敗・読み込みを個別に検証する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { test, expect } = require("../support/scratch-test.cjs");

async function captureSymbolStory({
	page,
	root,
	theme,
	story,
	rotations,
	expect,
}) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-composer-symbols--${story}&viewMode=story&globals=theme:${theme}`,
	);
	const list = page.getByRole("listbox", { name: "シンボル" });
	const expected = {
		search: "UserService",
		"search-request-failure": "Host search failed",
		loading: "検索中",
	};
	await expect(list).toContainText(expected[story]);
	if (story === "loading") {
		const frames = await verifySpinner(page, list, expect);
		rotations.push({ theme, ...frames });
	}
	await page.screenshot({ path: path.join(root, `${theme}-${story}.png`) });
}
async function verifySpinner(page, list, expect) {
	const spinner = list.locator("svg");
	await expect(spinner).toHaveCSS("animation-name", "spin");
	const frames = await spinner.evaluate((element) => {
		const animation = element.getAnimations()[0];
		animation.pause();
		animation.currentTime = 0;
		const initial =
			element.ownerDocument.defaultView.getComputedStyle(
				element,
			).transform;
		animation.currentTime = 250;
		const quarter =
			element.ownerDocument.defaultView.getComputedStyle(
				element,
			).transform;
		animation.play();
		return { initial, quarter };
	});
	expect(frames.initial).not.toBe(frames.quarter);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(spinner).toHaveCSS("animation-name", "none");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	return frames;
}
for (const story of ["search", "search-request-failure", "loading"]) {
	for (const theme of ["dark2026", "light"]) {
		test(`シンボル: ${story} ${theme} @visual @animation`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			const root = testInfo.outputPath("review");
			await fs.mkdir(root, { recursive: true });
			const page = await browser.newPage({
				viewport: { width: 420, height: 900 },
			});
			const rotations = [];
			await captureSymbolStory({
				page,
				root,
				theme,
				story,
				rotations,
				expect,
			});
			await fs.writeFile(
				path.join(root, "rotations.json"),
				JSON.stringify(rotations, null, 2),
			);
		});
	}
}
