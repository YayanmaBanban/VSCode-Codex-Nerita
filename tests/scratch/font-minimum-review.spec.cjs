// ケースの選択実行: pnpm test:scratch font-minimum-review.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

async function capture(
	browser,
	{ stage, directory, theme, width, story },
	errors,
) {
	const page = await browser.newPage({ viewport: { width, height: 950 } });
	page.on("pageerror", (error) =>
		errors.push({ story, message: error.message }),
	);
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
		);
		await page.waitForFunction(() =>
			globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) => render.phase === "finished",
			),
		);
		const result = await page.locator("body").evaluate((root) => {
			const small = [];
			for (const element of root.querySelectorAll("*")) {
				const hasText = [...element.childNodes].some(
					(node) => node.nodeType === 3 && node.textContent.trim(),
				);
				if (!hasText || !element.checkVisibility()) {
					continue;
				}
				const size = Number.parseFloat(
					globalThis.getComputedStyle(element).fontSize,
				);
				if (size < 12) {
					small.push({
						text: element.textContent.slice(0, 80),
						size,
					});
				}
			}
			return { small };
		});
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${story}.png`),
			fullPage: true,
		});
		if (stage === "after") {
			expect(result.small, `${theme}/${width}/${story}`).toEqual([]);
		}
		return { theme, width, story, ...result };
	} finally {
		await page.close();
	}
}

const storyIds = [
	"trust-manager--default",
	"trust-manager--codex",
	"chat-dlc-workspace-states--error-recovery",
	"chat-dlc-phases--expand-and-collapse",
	"chat-contributions--codex-app-server",
	"chat-personality--editable",
];
for (const id of storyIds) {
	for (const theme of ["dark2026", "light"]) {
		for (const width of [320, 960]) {
			test(`font-minimum-review: ${id} ${theme} ${width} @visual @layout`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				const directory = testInfo.outputPath("review");
				await mkdir(directory, { recursive: true });
				const errors = [];
				const stage = process.env.SCRATCH_PHASE ?? "after";
				const result = await capture(
					browser,
					{ stage, directory, theme, width, story: id },
					errors,
				);
				if (stage === "after") {
					expect(result.small).toEqual([]);
				}
				await writeFile(
					join(directory, "results.json"),
					JSON.stringify(result, null, 2),
				);
				expect(errors).toEqual([]);
			});
		}
	}
}
