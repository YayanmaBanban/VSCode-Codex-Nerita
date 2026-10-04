// `node tests/scratch/agent-manager-review.cjs before|after` で実行する。
// Storybook の実画面を明暗・狭幅で撮影し、コンソールエラーを収集する。
const { chromium } = require("playwright");
const fs = require("node:fs/promises");

async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/agent-manager-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		for (const [theme, width] of [
			["dark2026", 1100],
			["light", 420],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6007/iframe.html?id=agent-manager--${phase === "before" ? "settings" : "codex"}&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("heading", { name: "Agent Manager", exact: true })
				.waitFor();
			await page
				.getByText("設定を読み込み中…")
				.waitFor({ state: "hidden" });
			await page.screenshot({
				path: `${root}/${theme}-${width}.png`,
				fullPage: true,
			});
			if (phase === "after") {
				await reviewCards(page, root, `${theme}-${width}`);
			}
		}
		await fs.writeFile(`${root}/errors.json`, JSON.stringify(errors));
		if (errors.length) {
			throw new Error(errors.join("\n"));
		}
		console.log(root);
	} finally {
		await browser.close();
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
	await page.goto(
		page.url().replace("agent-manager--codex", "agent-manager--settings"),
	);
	await page.getByRole("textbox", { name: "名前", exact: true }).waitFor();
	await page.screenshot({ path: `${root}/${label}-pi.png`, fullPage: true });
	await reviewMotion(page, root, label);
	await page.goto(
		page
			.url()
			.replace("agent-manager--codex", "agent-manager--codex-defaults"),
	);
	await page.getByRole("slider", { name: "サンドボックスモード" }).waitFor();
	await page.screenshot({
		path: `${root}/${label}-defaults.png`,
		fullPage: true,
	});
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
	if (!(
		opening[0].height < opening[1].height &&
		opening[1].height < opening[2].height
	)) {
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
		if (!(frames[1].opacity > 0 && frames[1].opacity < 1)) {
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
	if (!(
		closing[0].height > closing[1].height &&
		closing[1].height > closing[2].height
	)) {
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
	if (!(
		closing[0].height > closing[1].height &&
		closing[1].height > closing[2].height &&
		opening[0].height < opening[1].height &&
		opening[1].height < opening[2].height
	)) {
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
		frames.push(
			await target.evaluate((element, fraction) => {
				const animations = element.getAnimations({ subtree: true });
				if (!animations.length) {
					throw new Error("対象のアニメーションがありません。");
				}
				for (const animation of animations) {
					animation.pause();
					animation.currentTime =
						Number(animation.effect.getTiming().duration) *
						fraction;
				}
				return {
					height: element.getBoundingClientRect().height,
					opacity: Number(
						globalThis.getComputedStyle(element.lastElementChild)
							.opacity,
					),
				};
			}, progress),
		);
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
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
