// Storybook で閉じたサイドバーの検索パネルを明暗・幅別に確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** パネルから選択してもサイドバーを展開せず、Escape と外側クリックで閉じられることを確認する。 */
async function reviewPanel(page, root, name, label, target) {
	const trigger = page.getByRole("button", { name: "検索", exact: true });
	await trigger.hover();
	await expect(page.getByRole("tooltip")).toHaveText("検索");
	await expect(page.getByRole("tooltip")).toBeVisible();
	await page.screenshot({ path: `${root}/${name}-tooltip.png` });
	await trigger.click();
	const panel = page.getByRole("dialog", {
		name: `${label}を検索`,
		exact: true,
	});
	const search = panel.getByRole("searchbox", { name: `${label}を検索` });
	await expect(search).toBeFocused();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await page.screenshot({ path: `${root}/${name}-panel-all.png` });
	await search.fill(target.toUpperCase());
	await expect(
		panel.getByRole("button", { name: target, exact: true }),
	).toBeVisible();
	await page.screenshot({ path: `${root}/${name}-panel.png` });
	await panel.getByRole("button", { name: target, exact: true }).click();
	await expect(panel).toHaveCount(0);
	await expect(trigger).toBeVisible();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await page
		.getByRole("heading", {
			name: label === "パスルール" ? "Pi ガードレール" : /^Agent Manager/,
			exact: true,
		})
		.click();
	await expect(panel).toHaveCount(0);
}

/** 各画面のサイドバーを閉じ、追加前後を同じ状態で撮影する。 */
async function reviewScenario(
	page,
	root,
	phase,
	theme,
	[story, width, label, target],
) {
	await page.setViewportSize({ width, height: 950 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
	);
	await page
		.getByRole("heading", {
			name: label === "パスルール" ? "Pi ガードレール" : /^Agent Manager/,
			exact: true,
		})
		.waitFor();
	if (width >= 760) {
		await page
			.getByRole("button", {
				name: "サイドバーを閉じる",
				exact: true,
			})
			.click();
	}
	await expect(
		page.getByRole("button", {
			name: "サイドバーを開く",
			exact: true,
		}),
	).toBeVisible();
	const name = `${theme}-${label}-${width}`;
	await page.screenshot({ path: `${root}/${name}-closed.png` });
	if (phase === "after") {
		await reviewPanel(page, root, name, label, target);
	}
}

/** 広いパスルールと広狭のエージェント管理を同じ条件で撮影し、エラーも収集する。 */
async function runCase(
	browser,
	testInfo,
	{ theme, story, width, label, target },
) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	{
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await reviewScenario(page, root, phase, theme, [
			story,
			width,
			label,
			target,
		]);

		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors }, null, 2),
		);
		console.log(root);
	}
}

for (const theme of ["dark2026", "light"]) {
	for (const [story, width, label, target] of [
		["pi-guardrails--editor", 1200, "パスルール", "env-files"],
		["agent-manager--settings", 1200, "エージェント", "reviewer"],
		["agent-manager--settings", 520, "エージェント", "reviewer"],
	]) {
		test(`selection-sidebar-search-review ${theme} ${typeof story === "string" ? story : story.id} ${width} ${label} ${target} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, {
				theme,
				story,
				width,
				label,
				target,
			});
		});
	}
}
