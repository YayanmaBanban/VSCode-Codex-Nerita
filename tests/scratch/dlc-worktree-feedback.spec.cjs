// 検証用 Storybook で Intent 作成前と Worktree 削除中の製品 UI を、明暗テーマと狭い表示幅で撮影する。
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 各ストーリーの操作完了後に表示と横方向のはみ出しを確認する。 */
async function runCase(browser, testInfo, { theme, width, story }) {
	const base = process.env.STORYBOOK_URL ?? "http://localhost:6006";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	await capture(browser, { base, directory, theme, width, story }, errors);

	await writeFile(
		join(directory, "errors.json"),
		JSON.stringify(errors, null, 2),
	);
	expect(errors).toEqual([]);
	console.log(directory);
}

/** 1画面ずつ開き、操作状態・スクリーンショット・横幅を確認して閉じる。 */
async function capture(
	browser,
	{ base, directory, theme, width, story },
	errors,
) {
	const page = await browser.newPage({
		viewport: { width, height: 960 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		`${base}/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
	);
	await page.waitForFunction(() =>
		globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some((render) =>
			["finished", "completed"].includes(render.phase),
		),
	);
	if (story.endsWith("empty-workspace")) {
		await expect(
			page.getByRole("combobox", {
				name: "DLC の Worktree",
			}),
		).toBeDisabled();
		await expect(page.getByRole("status")).toHaveText(
			"Intentの作成・選択を待っています",
		);
	} else {
		await expect(page.getByRole("status")).toHaveText("削除中");
	}
	await page.screenshot({
		path: join(directory, `${theme}-${width}-${story}.png`),
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth >
				globalThis.innerWidth,
		),
	).toBe(false);
	await page.close();
}

const conditions = ["dark2026", "light"].flatMap((theme) =>
	[320, 960].map((width) => ({ theme, width })),
);
for (const { theme, width } of conditions) {
	for (const story of [
		"chat-dlc-workspace-states--empty-workspace",
		"chat-dlc-workspace--removal-pending",
	]) {
		test(`dlc-worktree-feedback ${theme} ${width} ${typeof story === "string" ? story : story.id} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, width, story });
		});
	}
}
