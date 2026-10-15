// Storybook 起動後、node tests/scratch/dlc-stories-review.cjs で追加したワークスペース・Phase のシナリオを撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 追加ストーリーを明暗・狭幅で実行し、エラーと横方向のはみ出しも記録する。 */
async function main() {
	const base = process.argv[2] ?? "http://localhost:6006";
	const directory = join("dist/ui-review", `dlc-stories-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const index = await (await fetch(`${base}/index.json`)).json();
	const stories = Object.values(index.entries).filter(
		(entry) =>
			entry.type === "story" &&
			(entry.id.startsWith("chat-dlc-workspace-states--") ||
				entry.id.startsWith("chat-dlc-phases--")),
	);
	expect(stories.length).toBeGreaterThan(0);
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	const conditions = ["dark2026", "light"].flatMap((theme) =>
		[320, 960].map((width) => ({ theme, width })),
	);
	try {
		for (const { theme, width } of conditions) {
			for (const story of stories) {
				results.push(
					await capture(
						browser,
						{ base, directory, theme, width, story },
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
		expect(results.filter((result) => result.overflow)).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** ページを分けて play の完了を待ち、製品と同じテーマで撮影する。 */
async function capture(
	browser,
	{ base, directory, theme, width, story },
	errors,
) {
	const page = await browser.newPage({ viewport: { width, height: 1000 } });
	page.on("pageerror", (error) =>
		errors.push({ story: story.id, error: error.message }),
	);
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push({ story: story.id, error: message.text() });
		}
	});
	try {
		await page.goto(
			`${base}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`,
		);
		await page.waitForFunction(() =>
			globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) => render.phase === "finished",
			),
		);
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${story.id}.png`),
			fullPage: true,
		});
		const overflow = await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth >
				globalThis.innerWidth,
		);
		return { story: story.id, theme, width, overflow };
	} catch (error) {
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${story.id}-failed.png`),
			fullPage: true,
		});
		throw error;
	} finally {
		await page.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
