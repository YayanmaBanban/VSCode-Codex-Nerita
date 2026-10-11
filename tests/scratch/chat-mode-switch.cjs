// Storybook 起動後、`node tests/scratch/chat-mode-switch.cjs` でツールチップと選択枠の移動を確認する。
// Host 応答だけを注入し、CSS のトランジションを一時停止して指定時刻の位置と画像を保存する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** ライト・ダークテーマの狭い画面で、ツールチップ・フォーカス・選択枠の往復と、アニメーションの抑制を確認する。 */
async function main() {
	const directory = join("dist/ui-review", `chat-mode-switch-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 420]) {
				await reviewViewport(browser, directory, errors, theme, width);
			}
		}
		expect(errors).toEqual([]);
		await writeFile(
			join(directory, "errors.json"),
			JSON.stringify(errors, null, 2),
		);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** テーマと幅の組合せごとにツールチップと選択枠の往復を撮影し、失敗時も画面を残す。 */
async function reviewViewport(browser, directory, errors, theme, width) {
	const page = await browser.newPage({ viewport: { width, height: 600 } });
	const prefix = `${theme}-${width}`;
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-app--empty&viewMode=story&globals=theme:${theme}`,
		);
		const group = page.getByRole("group", { name: "作業モード" });
		await expect(group).toBeVisible();
		await selectMode(page, "chat");
		await reviewTooltips(page, group, directory, prefix);
		await page.mouse.move(width - 1, 599);
		await group.getByRole("button", { name: "DLC" }).blur();
		await captureFrames(page, group, directory, `${prefix}-to-dlc`, "dlc");
		await captureFrames(
			page,
			group,
			directory,
			`${prefix}-to-chat`,
			"chat",
		);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await selectMode(page, "dlc");
		await expect(group).toHaveAttribute("data-mode", "dlc");
		await expect
			.poll(() =>
				group
					.locator(".chat-mode-indicator")
					.evaluate((element) => element.getAnimations().length),
			)
			.toBe(0);
		await page.screenshot({
			path: join(directory, `${prefix}-reduced.png`),
		});
	} catch (error) {
		await page.screenshot({
			path: join(directory, `${prefix}-failed.png`),
		});
		throw error;
	} finally {
		await page.close();
	}
}

/** ホバーによるツールチップの表示を待って撮影し、キーボードでフォーカスしたときも表示されることを確認する。 */
async function reviewTooltips(page, group, directory, prefix) {
	for (const [label, description] of [
		["Chat", "チャットモード"],
		["DLC", "ライフサイクルモード"],
	]) {
		const button = group.getByRole("button", { name: label, exact: true });
		const tooltip = page.getByRole("tooltip", { name: description });
		await button.hover();
		await expect(tooltip).toBeVisible();
		await expect
			.poll(() =>
				tooltip.evaluate(
					(element) => globalThis.getComputedStyle(element).opacity,
				),
			)
			.toBe("1");
		await page.screenshot({
			path: join(directory, `${prefix}-${label}-tooltip.png`),
		});
		await button.press("Tab");
		await button.focus();
		await expect(button).toBeFocused();
		await expect(tooltip).toBeVisible();
	}
}

/** 通信型に沿った状態を、既存の `StoryBridge` から Host 応答として渡す。 */
async function selectMode(page, mode) {
	await page.evaluate((mode) => {
		globalThis.document
			.querySelector("[data-story-chat]")
			.storyBridge.emit({
				type: "dlc/state",
				view: {
					mode,
					backend: "codex",
					intents: [],
					environment: null,
					selected: null,
					error: null,
					active: null,
					targets: [],
					targetId: null,
					targetBusy: false,
					assignmentPending: false,
					running: [],
					execution: null,
				},
			});
	}, mode);
}

/** CSS のトランジションの時刻を指定し、始点・中間・終点の位置とテーマの適用値を保存する。 */
async function captureFrames(page, group, directory, prefix, mode) {
	await selectMode(page, mode);
	await expect(group).toHaveAttribute("data-mode", mode);
	const indicator = group.locator(".chat-mode-indicator");
	await indicator.evaluate((element) => {
		const animation = element.getAnimations()[0];
		if (!animation) {
			throw new Error("選択枠のトランジションが開始していません。");
		}
		animation.pause();
	});
	const frames = [];
	for (const [name, time] of [
		["initial", 0],
		["early", 24],
		["middle", 120],
		["late", 216],
		["completed", 240],
	]) {
		frames.push(
			await indicator.evaluate((element, time) => {
				for (const animation of element.getAnimations()) {
					animation.currentTime = time;
				}
				const style = globalThis.getComputedStyle(element);
				return {
					time,
					x: new globalThis.DOMMatrix(style.transform).m41,
					background: style.backgroundColor,
					border: style.boxShadow,
				};
			}, time),
		);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	const positions = frames.map((frame) => frame.x);
	if (mode === "dlc") {
		expect(positions[0]).toBeCloseTo(0);
		expect(positions[1]).toBeGreaterThan(positions[0]);
		expect(positions[2]).toBeGreaterThan(positions[1]);
		expect(positions[4]).toBeGreaterThan(positions[2]);
	} else {
		expect(positions[0]).toBeGreaterThan(positions[1]);
		expect(positions[1]).toBeGreaterThan(positions[2]);
		expect(positions[4]).toBeCloseTo(0);
	}
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await indicator.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
