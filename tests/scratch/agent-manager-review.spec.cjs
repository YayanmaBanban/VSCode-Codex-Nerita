// 実行: pnpm test:scratch agent-manager-review.spec.cjs --grep "ケース名"
// Storybook の実画面を明暗・狭幅で撮影し、コンソールエラーを収集する。
const { test } = require("../support/scratch-test.cjs");
const fs = require("node:fs/promises");

async function runCase(browser, testInfo, { theme, width }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	{
		const page = await browser.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await page.setViewportSize({ width, height: 950 });
		await page.goto(
			`http://localhost:6006/iframe.html?id=agent-manager--${phase === "before" ? "settings" : "codex"}&viewMode=story&globals=theme:${theme}`,
		);
		await page
			.getByRole("heading", { name: "Agent Manager", exact: true })
			.waitFor();
		await page.getByText("設定を読み込み中…").waitFor({ state: "hidden" });
		await page.screenshot({
			path: `${root}/${theme}-${width}.png`,
			fullPage: true,
		});
		if (phase === "after") {
			await reviewCards(page, root, `${theme}-${width}`);
		}

		await fs.writeFile(`${root}/errors.json`, JSON.stringify(errors));
		if (errors.length) {
			throw new Error(errors.join("\n"));
		}
		console.log(root);
	}
}

/** ポータルの設定カードと Pi の表示を実際の操作で確認する。 */
async function reviewCards(page, root, label) {
	await page.getByRole("button", { name: "モデルと推論レベル" }).click();
	await page.getByRole("slider", { name: "推論" }).waitFor();
	await page.screenshot({
		path: `${root}/${label}-model.png`,
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await page.getByText("高度な設定", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "承認ポリシー" })
		.selectOption("granular");
	await page.getByRole("button", { name: "サンドボックスモード" }).click();
	const slider = page.getByRole("slider", { name: "サンドボックスモード" });
	await slider.focus();
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await page.screenshot({
		path: `${root}/${label}-permissions.png`,
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	const dimensions = await page.evaluate(() => ({
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		background: globalThis.getComputedStyle(globalThis.document.body)
			.backgroundColor,
		color: globalThis.getComputedStyle(globalThis.document.body).color,
	}));
	if (dimensions.scrollWidth > dimensions.width) {
		throw new Error("画面が横にはみ出しています。");
	}
	await fs.writeFile(
		`${root}/${label}-layout.json`,
		JSON.stringify(dimensions),
	);
}

/** CSS アニメーションを時刻指定で停止し、開閉とフェードの中間表示を残す。 */
async function reviewMotion(page, root, label) {
	await page.goto(
		page.url().replace("agent-manager--settings", "agent-manager--codex"),
	);
	const advanced = page.getByRole("button", { name: "高度な設定" });
	const section = advanced.locator("..");
	await advanced.click();
	const opening = await sampleTransition(
		section,
		page,
		root,
		`${label}-opening`,
	);
	if (!(opening[0].height < opening[1].height)) {
		throw new Error("開く途中の高さが補間されていません。");
	}
	if (!(opening[1].height < opening[2].height)) {
		throw new Error("開く途中の高さが補間されていません。");
	}
	await page
		.getByRole("combobox", { name: "承認ポリシー" })
		.selectOption("granular");
	const checkbox = page.getByRole("checkbox", {
		name: "サンドボックス外での実行",
	});
	const indicator = checkbox.locator("..");
	await indicator.click();
	const fadingOut = await sampleTransition(
		indicator,
		page,
		root,
		`${label}-unchecked`,
	);
	await indicator.click();
	const fadingIn = await sampleTransition(
		indicator,
		page,
		root,
		`${label}-checked`,
	);
	for (const frames of [fadingOut, fadingIn]) {
		if (!(frames[1].opacity > 0)) {
			throw new Error("チェック表示のフェードが確認できません。");
		}
		if (!(frames[1].opacity < 1)) {
			throw new Error("チェック表示のフェードが確認できません。");
		}
	}
	await reviewGranularMotion(page, section, root, label);
	await advanced.click();
	const closing = await sampleTransition(
		section,
		page,
		root,
		`${label}-closing`,
	);
	if (!(closing[0].height > closing[1].height)) {
		throw new Error("閉じる途中の高さが補間されていません。");
	}
	if (!(closing[1].height > closing[2].height)) {
		throw new Error("閉じる途中の高さが補間されていません。");
	}
	await fs.writeFile(
		`${root}/${label}-motion.json`,
		JSON.stringify({ opening, closing, fadingIn, fadingOut }),
	);
}

/** ポリシーの切替でも項目の高さが途中まで補間されることを確認する。 */
async function reviewGranularMotion(page, section, root, label) {
	const panel = section.locator("fieldset").locator("../../..");
	const policy = page.getByRole("combobox", { name: "承認ポリシー" });
	await policy.selectOption("never");
	const closing = await sampleTransition(
		panel,
		page,
		root,
		`${label}-granular-closing`,
	);
	await policy.selectOption("granular");
	const opening = await sampleTransition(
		panel,
		page,
		root,
		`${label}-granular-opening`,
	);
	const closingShrinks =
		closing[0].height > closing[1].height &&
		closing[1].height > closing[2].height;
	const openingGrows =
		opening[0].height < opening[1].height &&
		opening[1].height < opening[2].height;
	if (!closingShrinks) {
		throw new Error("granular の開閉が補間されていません。");
	}
	if (!openingGrows) {
		throw new Error("granular の開閉が補間されていません。");
	}
	await fs.writeFile(
		`${root}/${label}-granular-motion.json`,
		JSON.stringify({ opening, closing }),
	);
}

/** 開始・中間・完了を同じ CSS アニメーションで比較する。 */
async function sampleTransition(target, page, root, label) {
	const frames = [];
	for (const progress of [0, 0.5, 1]) {
		const sampleAnimation = (element, fraction) => {
			const animations = element.getAnimations({ subtree: true });
			if (!animations.length) {
				throw new Error("対象のアニメーションがありません。");
			}
			for (const animation of animations) {
				animation.pause();
				animation.currentTime =
					Number(animation.effect.getTiming().duration) * fraction;
			}
			return {
				height: element.getBoundingClientRect().height,
				opacity: Number(
					globalThis.getComputedStyle(element.lastElementChild)
						.opacity,
				),
			};
		};
		frames.push(await target.evaluate(sampleAnimation, progress));
		await page.screenshot({
			path: `${root}/${label}-${progress}.png`,
			fullPage: true,
		});
	}
	await target.evaluate((element) => {
		for (const animation of element.getAnimations({ subtree: true })) {
			animation.finish();
		}
	});
	return frames;
}

for (const [theme, width] of [
	["dark2026", 1100],
	["light", 420],
]) {
	test(`agent-manager-review ${theme} ${width} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme, width });
	});
}

for (const theme of ["dark2026", "light"]) {
	for (const [scenario, review] of [
		["アニメーション", reviewMotion],
		[
			"Pi の表示",
			async (page, root, label) => {
				await page.goto(
					page
						.url()
						.replace(
							"agent-manager--codex",
							"agent-manager--settings",
						),
				);
				await page
					.getByRole("textbox", { name: "名前", exact: true })
					.waitFor();
				await page.screenshot({
					path: `${root}/${label}-pi.png`,
					fullPage: true,
				});
			},
		],
		[
			"Codex 既定値",
			async (page, root, label) => {
				await page.goto(
					page
						.url()
						.replace(
							"agent-manager--codex",
							"agent-manager--codex-defaults",
						),
				);
				await page
					.getByRole("slider", { name: "サンドボックスモード" })
					.waitFor();
				await page.screenshot({
					path: `${root}/${label}-defaults.png`,
					fullPage: true,
				});
			},
		],
	]) {
		test(`Agent Manager: ${scenario} ${theme} @animation @visual`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			const root = testInfo.outputPath("review");
			await fs.mkdir(root, { recursive: true });
			const page = await browser.newPage({
				viewport: { width: 1100, height: 950 },
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=agent-manager--codex&viewMode=story&globals=theme:${theme}`,
			);
			await review(page, root, theme);
		});
	}
}
