// Storybook 起動後、node tests/scratch/dlc-intent-stories.cjs で保留・実行先の固定ストーリーを撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const storybookUrl = process.argv[2] ?? "http://localhost:6006";

const stories = [
	{
		id: "worktree-required",
		label: "Worktree が必要",
		lastAction: "dlc/read",
	},
	{
		id: "trust-required",
		label: "信頼の確認が必要",
		lastAction: "dlc/trust",
	},
	{
		id: "unavailable",
		label: "開始条件の確認が必要",
		lastAction: "dlc/read",
	},
	{ id: "execution-targets" },
];

/** 各固定ストーリーを明暗・狭幅で撮影し、表示条件とブラウザーエラーを保存する。 */
async function main() {
	const directory = join(
		"dist/ui-review",
		`dlc-intent-stories-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	const conditions = ["dark2026", "light"].flatMap((theme) =>
		[320, 720].map((width) => ({ theme, width })),
	);
	try {
		for (const condition of conditions) {
			for (const story of stories) {
				results.push(
					await capture(
						browser,
						{ directory, ...condition, story },
						errors,
					),
				);
			}
		}
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ results, errors }, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** 保留の本文と状態説明、または実行先の全行が表示された状態を残す。 */
async function capture(browser, { directory, theme, width, story }, errors) {
	const page = await browser.newPage({ viewport: { width, height: 900 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`${storybookUrl}/iframe.html?id=chat-dlc-intent-list--${story.id}&viewMode=story&globals=theme:${theme}`,
		);
		await expect(page.locator("[data-story-intent-list]")).toHaveCSS(
			"max-width",
			"360px",
		);
		if (story.label) {
			await expect
				.poll(() =>
					page
						.locator("[data-story-intent-list]")
						.evaluate(
							(element) => element.bridge.sent.at(-1)?.type,
						),
				)
				.toBe(story.lastAction);
			await expect(page.getByLabel("実行開始の保留")).toBeVisible();
			const selected = page.getByRole("button", {
				name: "開始を保留している Intent",
				exact: true,
			});
			await expect(selected).toHaveAccessibleDescription(story.label);
			await selected.hover();
			await expect(
				page.getByRole("tooltip", { name: story.label }),
			).toHaveCSS("opacity", "1");
		} else {
			await expect(
				page.getByRole("button", {
					name: "実行先を選んでいない Intent",
					exact: true,
				}),
			).toBeVisible();
		}
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${story.id}.png`),
			fullPage: true,
		});
		const colors = await page.locator("body").evaluate((element) => {
			const style = globalThis.getComputedStyle(element);
			return {
				background: style.backgroundColor,
				foreground: style.color,
			};
		});
		return { theme, width, story: story.id, colors };
	} finally {
		await page.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
