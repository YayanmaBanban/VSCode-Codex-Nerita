// Storybook 起動後、node tests/scratch/dlc-intent-controls.cjs before|after で一覧と共通状態表示を撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗・狭幅の一覧と利用元のカードを比較し、ブラウザーエラーを記録する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`dlc-intent-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 1024]) {
				const page = await browser.newPage({
					viewport: { width, height: 900 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				await reviewList(page, { phase, directory, theme, width });
				await page.goto(
					`http://localhost:6006/iframe.html?id=chat-agents--states&viewMode=story&globals=theme:${theme}`,
				);
				await expect(page.locator(".agent-card")).toHaveCount(9);
				await page.screenshot({
					path: join(directory, `${theme}-${width}-agents.png`),
					fullPage: true,
				});
				await page.close();
			}
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

/** Host の状態更新で各 Intent 状態を並べ、アイコン操作と説明を確認する。 */
async function reviewList(page, { phase, directory, theme, width }) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-dlc-workspace--selection-and-creation&viewMode=story&globals=theme:${theme}`,
	);
	await expect(
		page.getByRole("button", { name: "新しい作業", exact: true }),
	).toBeVisible({ timeout: 30000 });
	await page.locator("[data-story-dlc]").evaluate((element) => {
		const statuses = [
			"idle",
			"running",
			"stopping",
			"review",
			"complete",
			"archived",
			"attention",
		];
		element.bridge.emit({
			type: "dlc/state",
			view: {
				mode: "dlc",
				backend: "codex",
				error: null,
				active: null,
				targets: [],
				targetId: null,
				targetBusy: false,
				assignmentPending: false,
				running: [],
				execution: null,
				selected: null,
				environment: { workspace: "sample", branch: "feature/dlc-ui" },
				intents: statuses.map((status, index) => ({
					intentId: `00000000-0000-4000-8000-00000000000${index + 1}`,
					title: `${status} Intent`,
					status,
				})),
			},
		});
	});
	const list = page.getByRole("complementary", { name: "Intent 一覧" });
	await expect(
		list.getByRole("button", { name: "attention Intent", exact: true }),
	).toBeAttached();
	const prefix = join(directory, `${theme}-${width}`);
	await page.screenshot({ path: `${prefix}-list.png`, fullPage: true });
	if (phase === "after") {
		await reviewActions(page, list, prefix, width);
		await expect(
			list.getByRole("button", { name: "idle Intent", exact: true }),
		).toHaveAccessibleDescription("待機");
		await page.emulateMedia({ reducedMotion: "reduce" });
		const animations = await list
			.locator(".status-indicator-dots, .status-indicator-running")
			.evaluateAll(
				(elements) =>
					elements.flatMap((element) =>
						element.getAnimations({ subtree: true }),
					).length,
			);
		expect(animations).toBe(0);
	}
}

/** 隣接するアイコンのハイライト・ツールチップと、再読み込みの送信を確認する。 */
async function reviewActions(page, list, prefix, width) {
	const create = list.getByRole("button", {
		name: "Intentの作成",
		exact: true,
	});
	const reload = list.getByRole("button", {
		name: "再読み込み",
		exact: true,
	});
	const creationBox = await create.boundingBox();
	const reloadBox = await reload.boundingBox();
	expect(reloadBox.y).toBe(creationBox.y);
	expect(reloadBox.x).toBeGreaterThan(creationBox.x + creationBox.width);
	for (const name of ["Intentの作成", "再読み込み"]) {
		const button = list.getByRole("button", { name, exact: true });
		await expect(button).toHaveText("");
		const background = await button.evaluate(
			(element) => globalThis.getComputedStyle(element).backgroundColor,
		);
		await button.hover();
		const tooltip = page.getByRole("tooltip", { name, exact: true });
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveCSS("opacity", "1");
		const hovered = await button.evaluate(
			(element) => globalThis.getComputedStyle(element).backgroundColor,
		);
		expect(hovered).not.toBe(background);
		await page.screenshot({
			path: `${prefix}-${name === "再読み込み" ? "reload" : "create"}.png`,
		});
		await page.mouse.move(width - 1, 899);
	}
	await reload.click();
	const message = await page
		.locator("[data-story-dlc]")
		.evaluate((element) => element.bridge.sent.at(-1));
	expect(message.type).toBe("dlc/read");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
