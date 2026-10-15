// Storybook 起動後、node tests/scratch/font-minimum-review.cjs before|after で実効サイズと表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

async function main() {
	const stage = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`font-minimum-${stage}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	const index = await (
		await fetch("http://localhost:6007/index.json")
	).json();
	const stories = Object.values(index.entries).filter(
		(entry) => entry.type === "story",
	);
	const selected = ["trust-manager--default", "trust-manager--codex"];
	for (const prefix of [
		"chat-dlc-workspace-states--",
		"chat-dlc-phases--",
		"chat-contributions--",
		"chat-personality--",
	]) {
		const story = stories.find((entry) => entry.id.startsWith(prefix));
		if (story) {
			selected.push(story.id);
		}
	}
	const conditions = ["dark2026", "light"].flatMap((theme) =>
		[320, 960].map((width) => ({ theme, width })),
	);
	try {
		for (const { theme, width } of conditions) {
			for (const story of selected) {
				results.push(
					await capture(
						browser,
						{ stage, directory, theme, width, story },
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
		if (stage === "after") {
			expect(results.flatMap((result) => result.small)).toEqual([]);
		}
		console.log(directory);
	} finally {
		await browser.close();
	}
}

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
			`http://localhost:6007/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
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

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
