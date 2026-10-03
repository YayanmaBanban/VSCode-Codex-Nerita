// Storybook 起動後、`node tests/scratch/tool-card-animation.cjs after` で変更後の開閉を確認する。変更前は引数を `before` にする。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマで始点・終点と、時間を固定した開閉の途中を撮影する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`tool-card-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 900 },
			});
			captureErrors(page, errors);
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-tool-cards--large-output&viewMode=story&globals=theme:${theme}`,
			);
			const heading = page.locator(".tool-heading");
			await expect(heading).toHaveAttribute("aria-expanded", "false");
			await page.screenshot({
				path: join(directory, `${theme}-initial.png`),
			});
			await heading.click();
			await expect(heading).toHaveAttribute("aria-expanded", "true");
			await expect(page.locator(".tool-body")).toContainText(
				"末尾エラー",
			);
			if (phase === "after") {
				await captureTransition(page, directory, `${theme}-opening`);
			}
			await page.screenshot({
				path: join(directory, `${theme}-opened.png`),
			});
			await page.getByRole("button", { name: "完了通知を受信" }).click();
			if (phase === "after") {
				await expect(heading).toHaveAttribute("aria-expanded", "true");
				await expect(
					page.locator(".tool-card-collapse"),
				).not.toHaveAttribute("inert", "");
				await page.screenshot({
					path: join(directory, `${theme}-completed-open.png`),
				});
				await heading.click();
			}
			await expect(heading).toHaveAttribute("aria-expanded", "false");
			if (phase === "after") {
				await captureTransition(page, directory, `${theme}-closing`);
				await expect(
					page.locator(".tool-card-collapse"),
				).toHaveAttribute("inert", "");
				await expect(page.locator(".tool-card-collapse")).toBeHidden();
			}
			await page.screenshot({
				path: join(directory, `${theme}-closed.png`),
			});
			await heading.click();
			await expect(heading).toHaveAttribute("aria-expanded", "true");
			if (phase === "after") {
				await heading.click();
				await heading.click();
				await expect(heading).toHaveAttribute("aria-expanded", "true");
				await page.emulateMedia({ reducedMotion: "reduce" });
				await heading.click();
				await expect(page.locator(".tool-card-collapse")).toBeHidden();
			}
			await page.close();
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

/** 表示確認中に発生したブラウザー内の実行エラーを収集する。 */
function captureErrors(page, errors) {
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
}

/** CSS トランジションを一時停止し、指定時刻の高さと透明度を画像と数値で確認する。 */
async function captureTransition(page, directory, prefix) {
	await page.locator(".tool-card-collapse").evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
		}
	});
	const frames = [];
	for (const [name, time] of [
		["early", 22],
		["middle", 110],
		["late", 198],
		["completed", 220],
	]) {
		const frame = await page
			.locator(".tool-card-collapse")
			.evaluate((element, time) => {
				for (const animation of element.getAnimations()) {
					animation.currentTime = time;
				}
				return {
					time,
					height: element.getBoundingClientRect().height,
					opacity: globalThis.getComputedStyle(element).opacity,
				};
			}, time);
		frames.push(frame);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	expect(frames[0].height).not.toBe(frames[3].height);
	expect(Number(frames[1].opacity)).toBeGreaterThan(0);
	expect(Number(frames[1].opacity)).toBeLessThan(1);
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await page.locator(".tool-card-collapse").evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
