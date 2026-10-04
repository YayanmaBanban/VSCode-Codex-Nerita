// Storybook 起動後、`node tests/scratch/output-copy-motion.cjs` で出力のコピー結果のカーテンとシェイクを確認する。回答を確認する場合は末尾に `answer` を付ける。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマでアニメーションの時刻を固定し、色・移動・連続実行と動きの抑制を確認する。 */
async function main() {
	const answer = process.argv[2] === "answer";
	const directory = join(
		"dist/ui-review",
		`${answer ? "answer" : "output"}-copy-motion-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 320, height: 900 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.addInitScript(configureClipboard);
			await page.goto(
				`http://localhost:6006/iframe.html?id=${answer ? "chat-messages--answer-copy" : "chat-tool-cards--large-output"}&viewMode=story&globals=theme:${theme}`,
			);
			if (!answer) {
				await page.locator(".tool-heading").click();
			}
			const button = page.getByRole("button", {
				name: answer ? "回答をコピー" : "出力をコピー",
				exact: true,
			});
			await expect(button).toBeVisible({ timeout: 30000 });
			await page.screenshot({
				path: join(directory, `${theme}-initial.png`),
				animations: "disabled",
			});
			for (const result of ["success", "error"]) {
				await page.evaluate((result) => {
					globalThis.copyFails = result === "error";
				}, result);
				await button.click();
				await expect(button).toHaveAttribute(
					"data-copy-result",
					result,
				);
				await captureFrames(
					page,
					button,
					directory,
					`${theme}-${result}`,
					result,
				);
				await expect(button).not.toHaveAttribute("data-copy-result");
			}
			await verifyRepeatedCopyAndReducedMotion(
				page,
				button,
				directory,
				theme,
			);
			await page.close();
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

/** OS のクリップボードだけを代替し、画面操作で成功・失敗を切り替えられるようにする。 */
function configureClipboard() {
	globalThis.copyFails = false;
	Object.defineProperty(navigator, "clipboard", {
		value: {
			writeText: async () => {
				if (globalThis.copyFails) {
					throw new Error("clipboard unavailable");
				}
			},
		},
	});
}

/** 連続コピーで演出が再開し、動きの抑制設定では演出が表示されないことを確認する。 */
async function verifyRepeatedCopyAndReducedMotion(
	page,
	button,
	directory,
	theme,
) {
	await button.click();
	await expect(button).toHaveAttribute("data-copy-result", "error");
	await button.locator(".copy-curtain").evaluate((element) => {
		globalThis.previousCurtain = element;
	});
	await button.click();
	await expect
		.poll(() =>
			button
				.locator(".copy-curtain")
				.evaluate((element) => element !== globalThis.previousCurtain),
		)
		.toBe(true);
	await expect(button).toBeFocused();
	await page.emulateMedia({ reducedMotion: "reduce" });
	await button.click();
	await expect(button).toHaveAttribute("data-copy-result", "error");
	await expect(button.locator(".copy-curtain")).toBeHidden();
	await expect
		.poll(() =>
			button.evaluate(
				(element) => element.getAnimations({ subtree: true }).length,
			),
		)
		.toBe(0);
	await page.screenshot({ path: join(directory, `${theme}-reduced.png`) });
	await expect(button).not.toHaveAttribute("data-copy-result");
	await expect(page.getByText("コピーしました", { exact: true })).toHaveCount(
		0,
	);
}

/** CSS カーテンと WAAPI のシェイクを停止し、同じ時刻の画像と変位を保存する。 */
async function captureFrames(page, button, directory, prefix, result) {
	await button.evaluate((element) => {
		for (const animation of element.getAnimations({ subtree: true })) {
			animation.pause();
		}
	});
	const frames = [];
	for (const [name, time] of [
		["initial", 0],
		["early", 44],
		["middle", 220],
		["late", 396],
		["completed", 440],
	]) {
		frames.push(
			await button.evaluate((element, time) => {
				for (const animation of element.getAnimations({
					subtree: true,
				})) {
					animation.currentTime = time;
				}
				const curtain = element.querySelector(".copy-curtain");
				return {
					time,
					x: new globalThis.DOMMatrix(
						globalThis.getComputedStyle(curtain).transform,
					).m41,
					shake: new globalThis.DOMMatrix(
						globalThis.getComputedStyle(element).transform,
					).m41,
					color: globalThis.getComputedStyle(curtain).backgroundColor,
				};
			}, time),
		);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	expect(frames[0].x).toBeLessThan(0);
	expect(frames[2].x).toBeCloseTo(0);
	expect(frames[4].x).toBeGreaterThan(0);
	if (result === "error") {
		expect(frames[1].shake).not.toBe(0);
	} else {
		expect(frames[1].shake).toBe(0);
	}
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
