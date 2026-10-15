// Storybook の Host 応答を使い、node tests/scratch/dlc-worktree-status.cjs before|after で状態表示を撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 実コンポーネントへ状態を配信し、明暗・狭幅と動きを減らす設定を確認する。 */
async function main() {
	const stage = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`dlc-worktree-status-${stage}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 720]) {
				await captureCondition(
					browser,
					{ directory, stage, theme, width },
					errors,
				);
			}
		}
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** テーマと幅ごとにページを分離し、状態表示と回転の低減設定を確認する。 */
async function captureCondition(
	browser,
	{ directory, stage, theme, width },
	errors,
) {
	const page = await browser.newPage({
		viewport: { width, height: 1000 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-dlc-workspace--execution-environment&viewMode=story&globals=theme:${theme}`,
		);
		await page.waitForFunction(() =>
			globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) => render.phase === "finished",
			),
		);
		for (const state of ["busy", "pending", "both", "idle"]) {
			await page
				.locator("[data-story-dlc]")
				.evaluate(async (element, state) => {
					const { environmentView } =
						await import("/stories/chat/dlc/workspaceState.ts");
					element.bridge.emit({
						type: "dlc/state",
						view: {
							...environmentView(),
							targetBusy: state === "busy" || state === "both",
							assignmentPending:
								state === "pending" || state === "both",
						},
					});
				}, state);
			const card = page.getByRole("region", {
				name: "実行環境",
			});
			await expect(card.getByRole("status")).toHaveCount(
				state === "both" ? 2 : Number(state !== "idle"),
			);
			await card.screenshot({
				path: join(directory, `${theme}-${width}-${state}.png`),
			});
			if (stage === "after" && state === "pending") {
				await page.emulateMedia({
					reducedMotion: "reduce",
				});
				await expect(card.getByRole("status").locator("svg")).toHaveCSS(
					"animation-name",
					"none",
				);
				await page.emulateMedia({
					reducedMotion: "no-preference",
				});
			}
		}
	} finally {
		await page.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
