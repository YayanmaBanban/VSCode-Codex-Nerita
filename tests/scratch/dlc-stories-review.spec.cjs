// ケースの選択実行: pnpm test:scratch dlc-stories-review.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

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

const storyIds = [
	"chat-dlc-phases--expand-and-collapse",
	"chat-dlc-phases--plan-registration",
	"chat-dlc-phases--ready-to-run",
	"chat-dlc-phases--running",
	"chat-dlc-phases--stopping",
	"chat-dlc-phases--retry-and-history",
	"chat-dlc-phases--cancelled",
	"chat-dlc-phases--interrupted",
	"chat-dlc-phases--new-intent",
	"chat-dlc-phases--awaiting-review",
	"chat-dlc-phases--stage-states",
	"chat-dlc-phases--advance-and-archive",
	"chat-dlc-workspace-states--error-recovery",
	"chat-dlc-workspace-states--recovery-succeeded",
	"chat-dlc-workspace-states--untrusted-startup",
	"chat-dlc-workspace-states--other-intent-running",
	"chat-dlc-workspace-states--assignment-pending",
	"chat-dlc-workspace-states--selection-pending",
	"chat-dlc-workspace-states--empty-workspace",
];
for (const id of storyIds) {
	for (const theme of ["dark2026", "light"]) {
		for (const width of [320, 960]) {
			test(`dlc-stories-review: ${id} ${theme} ${width} @visual @layout`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				const directory = testInfo.outputPath("review");
				await mkdir(directory, { recursive: true });
				const errors = [];
				const result = await capture(
					browser,
					{
						base:
							process.env.STORYBOOK_URL ??
							"http://localhost:6006",
						directory,
						theme,
						width,
						story: { id },
					},
					errors,
				);
				expect(result.overflow).toBe(false);
				await writeFile(
					join(directory, "results.json"),
					JSON.stringify(result, null, 2),
				);
				expect(errors).toEqual([]);
			});
		}
	}
}
