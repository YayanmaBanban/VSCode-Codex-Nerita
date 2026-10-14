// Storybook 起動後、`node tests/scratch/chat-search-animation.cjs before|after` で検索パネルの表示と開閉を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマと狭い幅で、検索の開閉・フォーカス・動きを減らす設定を確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`chat-search-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	const results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 720]) {
				results.push(
					await review(
						browser,
						theme,
						width,
						phase,
						directory,
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

/** Svelte が生成する実際のアニメーションを開始直後に停止し、撮影中の時刻を固定する。 */
async function installAnimationCapture(page) {
	await page.evaluate(() => {
		const animate = globalThis.Element.prototype.animate;
		globalThis.searchOriginalAnimate = animate;
		globalThis.window.searchAnimations = [];
		globalThis.Element.prototype.animate = function (...args) {
			const animation = animate.apply(this, args);
			const duration = Number(animation.effect.getTiming().duration);
			if (this.classList.contains("chat-search-shell") && duration > 0) {
				animation.pause();
				globalThis.window.searchAnimations.push(animation);
			}
			return animation;
		};
	});
}

/** 開始・途中・完了を同じアニメーションで確認し、会話欄の移動も記録する。 */
async function capture(page, directory, prefix) {
	await expect
		.poll(() =>
			page.evaluate(() => globalThis.window.searchAnimations.length),
		)
		.toBeGreaterThan(0);
	const frames = [];
	for (const [name, progress] of [
		["initial", 0],
		["early", 0.1],
		["middle", 0.5],
		["late", 0.9],
		["completed", 1],
	]) {
		frames.push(
			await page.evaluate((progress) => {
				const animation = globalThis.window.searchAnimations.at(-1);
				animation.currentTime =
					Number(animation.effect.getTiming().duration) * progress;
				const shell =
					globalThis.document.querySelector(".chat-search-shell");
				const styles = globalThis.getComputedStyle(shell);
				return {
					progress,
					height: shell.getBoundingClientRect().height,
					opacity: Number(styles.opacity),
					conversationTop: globalThis.document
						.querySelector('[aria-label="会話"]')
						.getBoundingClientRect().top,
				};
			}, progress),
		);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	const first = frames[0].height;
	const last = frames[4].height;
	expect(first).not.toBe(last);
	expect(frames[2].height).toBeGreaterThan(Math.min(first, last));
	expect(frames[2].height).toBeLessThan(Math.max(first, last));
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await finishAnimations(page);
	return frames;
}

/** 停止したアニメーションを完了させ、Svelte の終了処理を進める。 */
async function finishAnimations(page) {
	await page.evaluate(() => {
		for (const animation of globalThis.window.searchAnimations.splice(0)) {
			animation.finish();
		}
	});
}

/** 実コンポーネントをキーボードで開き、検索・取り消し・再表示を確認する。 */
async function review(browser, theme, width, phase, directory, errors) {
	const page = await browser.newPage({ viewport: { width, height: 820 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.route("**/favicon.ico", (route) =>
		route.fulfill({ status: 204 }),
	);
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-search--ready&viewMode=story&globals=theme:${theme}`,
		);
		const conversation = page.getByRole("region", {
			name: "会話",
			exact: true,
		});
		await expect(conversation).toBeVisible();
		await prepareAnimationReview(page, phase);
		await conversation.focus();
		const prefix = `${theme}-${width}`;
		await page.screenshot({
			path: join(directory, `${prefix}-closed.png`),
		});
		await page.keyboard.press("Control+f");
		const input = page.getByRole("textbox", {
			name: "会話を検索",
			exact: true,
		});
		await expect(input).toBeFocused();
		if (phase === "after") {
			await capture(page, directory, `${prefix}-opening`);
		}
		const panel = page.locator(".chat-search");
		await expect(panel).toBeVisible();
		await page.screenshot({
			path: join(directory, `${prefix}-opened.png`),
		});
		const appearance = await inspectPanel(panel, phase, width);
		await input.fill("[");
		await page
			.getByRole("button", { name: "正規表現", exact: true })
			.click();
		await expect(page.getByRole("alert")).toHaveText(
			"正規表現が正しくありません。",
		);
		await page.screenshot({ path: join(directory, `${prefix}-error.png`) });
		await input.press("Escape");
		if (phase === "after") {
			await expect(page.locator(".chat-search-shell")).toHaveAttribute(
				"inert",
				"",
			);
			await capture(page, directory, `${prefix}-closing`);
		}
		await expect(page.getByRole("search")).toHaveCount(0);
		await expect(conversation).toBeFocused();
		if (phase === "after") {
			await reviewReopening(page, input);
		}
		return { theme, width, appearance };
	} finally {
		await page.close();
	}
}

/** パネル形状と入力欄の塗りを記録し、横スクロールが増えていないことを確認する。 */
async function inspectPanel(panel, phase, width) {
	const appearance = await panel.evaluate((element) => {
		const styles = globalThis.getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return {
			background: styles.backgroundColor,
			border: styles.borderTopWidth,
			radius: styles.borderRadius,
			inputBackground: globalThis.getComputedStyle(
				element.querySelector("form > div"),
			).backgroundColor,
			x: rect.x,
			width: rect.width,
			scrollWidth: globalThis.document.documentElement.scrollWidth,
		};
	});
	if (phase === "after") {
		expect(parseFloat(appearance.radius)).toBeGreaterThan(0);
		expect(appearance.border).toBe("1px");
		expect(appearance.x).toBeGreaterThan(0);
		expect(appearance.scrollWidth).toBe(width);
	}
	return appearance;
}

/** ストーリー自身の操作が完了してから、撮影用の時刻固定を開始する。 */
async function prepareAnimationReview(page, phase) {
	if (phase === "after") {
		await page.waitForFunction(() =>
			globalThis.window.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) =>
					render.id === "chat-search--ready" &&
					render.phase === "finished",
			),
		);
		await page
			.getByRole("textbox", { name: "会話を検索", exact: true })
			.press("Escape");
		await expect(page.getByRole("search")).toHaveCount(0);
		await installAnimationCapture(page);
	}
}

/** 時刻固定を解除し、実時間での素早い開き直しと動きを減らす設定を確認する。 */
async function reviewReopening(page, input) {
	await page.evaluate(() => {
		globalThis.Element.prototype.animate = globalThis.searchOriginalAnimate;
	});
	await page.keyboard.press("Control+f");
	await expect(input).toBeFocused();
	await input.press("Escape");
	await page.keyboard.press("Control+f");
	await expect(input).toBeFocused();
	await expect(page.getByRole("search")).toHaveCount(1);
	await expect(page.locator(".chat-search-shell")).not.toHaveAttribute(
		"inert",
		"",
	);
	await input.press("Escape");
	await expect(page.getByRole("search")).toHaveCount(0);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.keyboard.press("Control+f");
	await expect(input).toBeFocused();
	await expect
		.poll(() =>
			page
				.locator(".chat-search-shell")
				.evaluate((element) => element.getAnimations().length),
		)
		.toBe(0);
	await input.press("Escape");
	await expect(page.getByRole("search")).toHaveCount(0);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
