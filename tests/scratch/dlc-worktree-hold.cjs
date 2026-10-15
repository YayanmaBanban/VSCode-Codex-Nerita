// Storybook 起動後、node tests/scratch/dlc-worktree-hold.cjs で実行環境と長押し削除を撮影・検証する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const storybookUrl = process.argv[2] ?? "http://localhost:6006";
const story = "chat-dlc-workspace--execution-environment";

/** 明暗・幅の確認と、実際のマウス入力による長押しを実行ごとに記録する。 */
async function main() {
	const directory = join("dist/ui-review", `dlc-worktree-hold-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 720]) {
				results.push(
					await captureCondition(
						browser,
						directory,
						errors,
						theme,
						width,
					),
				);
			}
		}
		results.push(await verifyHold(browser, directory, errors));
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ results, errors }, null, 2),
		);
		expect(errors).toEqual([]);
		expect(results.filter((result) => result.overflow)).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** 各テーマと幅でカード・メニューを撮影し、ページを確実に閉じる。 */
async function captureCondition(browser, directory, errors, theme, width) {
	const page = await browser.newPage({ viewport: { width, height: 1000 } });
	collectErrors(page, errors);
	try {
		await openStory(page, theme);
		await page.getByRole("region", { name: "実行環境" }).screenshot({
			path: join(directory, `${theme}-${width}-card.png`),
		});
		await openMenu(page);
		await page.getByRole("dialog", { name: "実行先を選択" }).screenshot({
			path: join(directory, `${theme}-${width}-menu.png`),
		});
		return await page.evaluate(() => ({
			width: globalThis.innerWidth,
			overflow:
				globalThis.document.documentElement.scrollWidth >
				globalThis.innerWidth,
			background: globalThis.getComputedStyle(globalThis.document.body)
				.backgroundColor,
			foreground: globalThis.getComputedStyle(globalThis.document.body)
				.color,
		}));
	} finally {
		await page.close();
	}
}

/** 実行時エラーとコンソールエラーを表示検証と同じページで収集する。 */
function collectErrors(page, errors) {
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
}

/** 既定の現在ワークスペースと Host 応答の反映を待つ。 */
async function openStory(page, theme) {
	await page.goto(
		`${storybookUrl}/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
	);
	await expect(
		page.getByRole("combobox", { name: "DLC の Worktree" }),
	).toContainText("現在のワークスペース", { timeout: 30000 });
	await page.waitForFunction(() =>
		globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
			(render) => render.phase === "finished",
		),
	);
}

/** 削除ボタンを独立して操作できる実行先ダイアログを開く。 */
async function openMenu(page) {
	await page.getByRole("combobox", { name: "DLC の Worktree" }).click();
	await expect(
		page.getByRole("dialog", { name: "実行先を選択" }),
	).toBeVisible();
}

/** 削除要求だけを観測し、選択要求の混入や重複送信を検出する。 */
async function removals(page) {
	return page
		.locator("[data-story-dlc]")
		.evaluate((element) =>
			element.bridge.sent.filter(
				(message) => message.type === "dlc/worktreeRemove",
			),
		);
}

/** ボタンの中央から実際の主ボタン押下を開始する。 */
async function mouseDown(page, button) {
	const bounds = await button.boundingBox();
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await page.mouse.down();
}

/** 時間制御で2秒の境界と取消しを検証し、CSS アニメーションも指定時刻へ移動して撮影する。 */
async function verifyHold(browser, directory, errors) {
	const page = await browser.newPage({
		viewport: { width: 720, height: 1000 },
	});
	collectErrors(page, errors);
	try {
		await page.clock.install();
		await openStory(page, "dark2026");
		await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
		await openMenu(page);
		const remove = page.getByRole("button", { name: "work-newを削除" });
		await remove.hover();
		await page.clock.runFor(150);
		await expect(
			page.getByRole("tooltip", { name: "ワークツリーの削除" }),
		).toBeVisible();
		await page.screenshot({ path: join(directory, "delete-tooltip.png") });
		await verifyCancellations(page, remove);
		await mouseDown(page, remove);
		const frames = [];
		let previous = 0;
		for (const [name, time] of [
			["early", 250],
			["middle", 1000],
			["late", 1750],
			["before-completion", 1999],
		]) {
			await page.clock.runFor(time - previous);
			frames.push(await captureFrame(remove, time));
			await page
				.getByRole("dialog", { name: "実行先を選択" })
				.screenshot({ path: join(directory, `hold-${name}.png`) });
			expect(await removals(page)).toHaveLength(0);
			previous = time;
		}
		await page.clock.runFor(1);
		expect(await removals(page)).toMatchObject([
			{ type: "dlc/worktreeRemove", targetId: "worktree" },
		]);
		await page.mouse.up();
		await page.clock.runFor(2200);
		expect(await removals(page)).toHaveLength(1);
		await page
			.getByRole("dialog", { name: "実行先を選択" })
			.screenshot({ path: join(directory, "hold-completed.png") });
		return {
			frames,
			cancellations: [
				"release",
				"move-outside",
				"pointercancel",
				"window-blur",
				"menu-close",
			],
			deletedAt: 2000,
		};
	} catch (error) {
		await page.screenshot({ path: join(directory, "hold-failed.png") });
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
		throw error;
	} finally {
		await page.close();
	}
}

/** 長押しの解除・領域外移動・入力中断・ウィンドウ切替・メニュー破棄では削除を送らない。 */
async function verifyCancellations(page, remove) {
	for (const reason of [
		"release",
		"move-outside",
		"pointercancel",
		"window-blur",
		"menu-close",
	]) {
		await mouseDown(page, remove);
		await page.clock.runFor(500);
		if (reason === "move-outside") {
			await page.mouse.move(0, 0);
		}
		if (reason === "pointercancel") {
			await remove.dispatchEvent("pointercancel");
		}
		if (reason === "window-blur") {
			await page.evaluate(() =>
				globalThis.dispatchEvent(new Event("blur")),
			);
		}
		if (reason === "menu-close") {
			await page.keyboard.press("Escape");
		}
		await page.mouse.up();
		await page.clock.runFor(2200);
		expect(await removals(page)).toHaveLength(0);
		if (reason === "menu-close") {
			await openMenu(page);
			// 時間停止中に予約されたメニューの初期フォーカスを、次の長押し前に完了させる。
			await page.clock.runFor(50);
		}
	}
}

/** CSS の進行とシェイクを同じ指定時刻へ固定し、カーテンが左から増えることを確認する。 */
async function captureFrame(button, time) {
	const frame = await button.evaluate((element, currentTime) => {
		for (const animation of element.getAnimations({ subtree: true })) {
			animation.pause();
			animation.currentTime = currentTime;
		}
		const curtain = element.querySelector(".hold-curtain");
		const style = globalThis.getComputedStyle(curtain);
		return {
			time: currentTime,
			progress: new globalThis.DOMMatrixReadOnly(style.transform).a,
			origin: style.transformOrigin,
			color: style.backgroundColor,
			shake: globalThis.getComputedStyle(element).transform,
		};
	}, time);
	expect(frame.progress).toBeCloseTo(time / 2000, 2);
	expect(frame.origin.startsWith("0px")).toBe(true);
	return frame;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
