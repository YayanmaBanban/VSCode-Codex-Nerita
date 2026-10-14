// Storybook 起動後、`node tests/scratch/dlc-intent-animation.cjs` で保留詳細の開閉と途中の表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗・狭幅で開閉の各時点を撮影し、選択切り替えと動きを減らす設定を確認する。 */
async function main() {
	const directory = join(
		"dist/ui-review",
		`dlc-intent-animation-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 720]) {
				await review(browser, { theme, width, directory }, errors);
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

/** 準備用のアニメーションを通し、保留詳細の実際の開閉だけを停止する。 */
async function installCapture(page) {
	await page.evaluate(() => {
		globalThis.intentAnimations = [];
		const animate = globalThis.Element.prototype.animate;
		globalThis.intentOriginalAnimate = animate;
		globalThis.Element.prototype.animate = function (...args) {
			const animation = animate.apply(this, args);
			if (
				this.classList.contains("dlc-intent-hold") &&
				Number(animation.effect.getTiming().duration) > 0
			) {
				animation.pause();
				globalThis.intentAnimations.push(animation);
			}
			return animation;
		};
	});
}

/** 時刻を固定した開始・途中・完了の高さを確認し、終了後に Svelte の後処理を進める。 */
async function capture(page, panel, directory, prefix) {
	await expect
		.poll(() => page.evaluate(() => globalThis.intentAnimations.length))
		.toBeGreaterThan(0);
	const frames = [];
	for (const [name, progress] of [
		["initial", 0],
		["early", 0.1],
		["middle", 0.5],
		["late", 0.9],
		["completed", 1],
	]) {
		await page.evaluate((progress) => {
			const animation = globalThis.intentAnimations.at(-1);
			animation.currentTime =
				Number(animation.effect.getTiming().duration) * progress;
		}, progress);
		frames.push(
			await panel.evaluate((element) => ({
				height: element.getBoundingClientRect().height,
				inert: element.inert,
			})),
		);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	expect(frames[0].height).not.toBe(frames[4].height);
	expect(frames[2].height).toBeGreaterThan(
		Math.min(frames[0].height, frames[4].height),
	);
	expect(frames[2].height).toBeLessThan(
		Math.max(frames[0].height, frames[4].height),
	);
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await page.evaluate(() => {
		for (const animation of globalThis.intentAnimations.splice(0)) {
			animation.finish();
		}
	});
}

/** 製品のコントローラーへ既存の検証データを Host の応答として配信する。 */
async function selectResponse(page, index) {
	await page
		.locator("[data-story-intent-list]")
		.evaluate((element, index) => {
			const view = globalThis.intentReviewView;
			const intent = view.intents[index];
			element.bridge.emit({
				type: "dlc/state",
				view: {
					...view,
					selected: {
						...view.selected,
						intentId: intent.intentId,
						title: intent.title,
					},
				},
			});
		}, index);
}

/** 時刻固定を解除し、実時間の選択切り替えと動きを減らす設定を検証する。 */
async function reviewSwitching(page, first, second) {
	await page.evaluate(() => {
		globalThis.Element.prototype.animate = globalThis.intentOriginalAnimate;
	});
	await first.click();
	await selectResponse(page, 0);
	await second.click();
	await selectResponse(page, 1);
	await expect(page.getByLabel("実行開始の保留")).toHaveCount(1);
	await expect(second).toHaveAttribute("aria-pressed", "true");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await first.click();
	await selectResponse(page, 0);
	await expect(first).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByLabel("実行開始の保留")).toHaveCount(1);
	await expect
		.poll(() =>
			page
				.locator(".dlc-intent-hold")
				.evaluate((element) => element.getAnimations().length),
		)
		.toBe(0);
}

/** ボタンと詳細が同じカード内に収まり、閉じる間の操作が無効になることを確認する。 */
async function review(browser, { theme, width, directory }, errors) {
	const page = await browser.newPage({ viewport: { width, height: 900 } });
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
			`http://localhost:6006/iframe.html?id=chat-dlc-intent-list--worktree-required&viewMode=story&globals=theme:${theme}`,
		);
		await page.waitForFunction(() =>
			globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) => render.phase === "finished",
			),
		);
		await page.evaluate(async () => {
			const { intentHoldView } =
				await import("/stories/chat/fixtures/dlcIntentList.ts");
			globalThis.intentReviewView = intentHoldView("worktree-required");
		});
		const first = page.getByRole("button", {
			name: "開始を保留している Intent",
			exact: true,
		});
		const second = page.getByRole("button", {
			name: "未選択の Intent",
			exact: true,
		});
		const cards = page.locator(".dlc-intent-card");
		await expect(cards.first().getByLabel("実行開始の保留")).toBeVisible();
		const prefix = `${theme}-${width}`;
		await page.mouse.move(width - 1, 899);
		await page.screenshot({
			path: join(directory, `${prefix}-opened.png`),
		});
		await installCapture(page);
		await second.click();
		const oldPanel = cards.first().locator(".dlc-intent-hold");
		await expect(oldPanel).toHaveAttribute("inert", "");
		await capture(page, oldPanel, directory, `${prefix}-closing`);
		await expect(oldPanel).toHaveCount(0);
		await selectResponse(page, 1);
		await capture(
			page,
			cards.nth(1).locator(".dlc-intent-hold"),
			directory,
			`${prefix}-opening`,
		);
		await reviewSwitching(page, first, second);
	} finally {
		await page.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
