// Storybook 起動後に node tests/scratch/guardrails-layout-review.cjs before|after で明暗・幅別の画面を比較する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

/** 両端の送り、リサイズ後の再判定、隠れていた項目の選択とフォーカス表示を確認する。 */
async function reviewTabs(page, root, label) {
	const nav = page.getByRole("navigation", { name: "ルールのカテゴリ" });
	const left = nav.getByRole("button", { name: "左のタブを表示" });
	const right = nav.getByRole("button", { name: "右のタブを表示" });
	await expect(left).toBeDisabled();
	await right.click();
	if (await right.isEnabled()) {
		await right.click();
	}
	await expect(right).toBeDisabled();
	await nav.getByRole("button", { name: "JSON", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "設定JSON" })).toBeVisible();
	await page.mouse.move(0, 0);
	await settleTabs(nav);
	await page.screenshot({ path: `${root}/${label}-tabs-end.png` });
	await left.click();
	await nav.getByRole("button", { name: "概要", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(left).toBeDisabled();
	await settleTabs(nav);
	await page.screenshot({ path: `${root}/${label}-tabs-focused.png` });
	await page.setViewportSize({ width: 900, height: 950 });
	await expect(right).toHaveCount(0);
	await page.setViewportSize({ width: 1200, height: 950 });
	await expect(right).toHaveCount(0);
	await page.setViewportSize({ width: 360, height: 950 });
	await expect(right).toBeVisible();
	const scrollbar = await nav
		.locator(".tab-viewport")
		.evaluate(
			(element) => globalThis.getComputedStyle(element).scrollbarWidth,
		);
	assert.equal(scrollbar, "none");
}

/** 移設した下線の有限アニメーションが終わってから静止画を残す。 */
async function settleTabs(nav) {
	await nav.evaluate(async (element) => {
		await Promise.all(
			element
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished),
		);
	});
}

/** 例外削除のホバー表示と、コマンドルールの短押し・長押しの違いを確認する。 */
async function reviewDeletionControls(page, root, label) {
	const nav = page.getByRole("navigation", { name: "ルールのカテゴリ" });
	await nav.getByRole("button", { name: /^パスルール/ }).click();
	await page.getByRole("button", { name: "例外の編集", exact: true }).click();
	const simple = page.getByRole("button", {
		name: "例外 1を削除",
		exact: true,
	});
	const before = await simple.evaluate(
		(element) => globalThis.getComputedStyle(element).backgroundColor,
	);
	await simple.hover();
	await expect(page.getByRole("tooltip")).toBeVisible();
	await expect(page.getByRole("tooltip")).toHaveText("例外を削除");
	const after = await simple.evaluate(
		(element) => globalThis.getComputedStyle(element).backgroundColor,
	);
	assert.notEqual(after, before);
	await page.screenshot({
		path: `${root}/${label}-delete-exception-hover.png`,
	});
	await simple.click();
	await expect(
		page.getByRole("textbox", { name: "例外 1", exact: true }),
	).toHaveValue(".env.sample");
	await nav.getByRole("button", { name: /^コマンドルール/ }).click();
	await page.getByRole("button", { name: /ルールを追加/ }).click();
	const hold = page.getByRole("button", {
		name: "コマンドルール 1を削除",
		exact: true,
	});
	await hold.click();
	await expect(
		page.getByRole("textbox", { name: "ID", exact: true }),
	).toBeVisible();
	await page.screenshot({ path: `${root}/${label}-delete-command.png` });
	await hold.focus();
	await page.keyboard.down("Enter");
	await expect(
		page.getByRole("textbox", { name: "ID", exact: true }),
	).toHaveCount(0);
	await page.keyboard.up("Enter");
	await page.screenshot({
		path: `${root}/${label}-delete-command-completed.png`,
	});
}

/** 説明のある選択肢から説明のない選択肢へ変えても、メニューを開き直せることを確認する。 */
async function reviewMatchSelection(page, root, label) {
	const match = page.getByRole("combobox", { name: "照合", exact: true });
	for (const name of [
		"ディレクトリ配下",
		"Glob",
		"ディレクトリ配下",
		"Glob",
	]) {
		await match.click();
		await expect(
			page.getByRole("option", { name, exact: true }),
		).toBeVisible();
		if (name === "ディレクトリ配下") {
			await page.screenshot({
				path: `${root}/${label}-match-reopened.png`,
			});
		}
		await page.getByRole("option", { name, exact: true }).click();
		await expect(match).toContainText(name);
	}
}

/** 組み込みを切り替え、狭い幅でもページ全体に横スクロールが出ないことを確認する。 */
async function reviewBuiltins(page, root, label) {
	const nav = page.getByRole("navigation", { name: "ルールのカテゴリ" });
	await nav.getByRole("button", { name: "組み込み", exact: true }).click();
	const ssh = page.getByRole("switch", { name: "SSH・秘密鍵を承認にする" });
	await expect(ssh).not.toBeChecked();
	await ssh.click();
	await expect(ssh).toBeChecked();
	await settleTabs(nav);
	assert.equal(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth >
				globalThis.innerWidth,
		),
		false,
	);
	await page.screenshot({ path: `${root}/${label}-builtins.png` });
	await nav.getByRole("button", { name: /^パスルール/ }).click();
}

/** 狭い画面の切替を経ても入力が残り、検査結果を確認できることを検証する。 */
async function reviewEditing(page, root, label, width) {
	await page
		.getByRole("textbox", { name: "ID", exact: true })
		.fill("review-env");
	const picker = await page
		.getByRole("combobox", { name: "パスルールを選択", exact: true })
		.boundingBox();
	const deletion = await page
		.getByRole("button", { name: "パスルール 1を削除", exact: true })
		.boundingBox();
	const id = await page
		.getByRole("textbox", { name: "ID", exact: true })
		.boundingBox();
	const action = await page
		.getByRole("combobox", { name: "判定", exact: true })
		.boundingBox();
	assert.ok(Math.abs(picker.height - deletion.height) < 1);
	assert.ok(Math.abs(id.height - action.height) < 1);
	const reason = await page
		.getByRole("textbox", { name: "理由", exact: true })
		.evaluate((element) => ({
			height: element.getBoundingClientRect().height,
			resize: globalThis.getComputedStyle(element).resize,
		}));
	assert.equal(reason.resize, "none");
	assert.ok(reason.height >= 80);
	await expect(
		page.getByRole("combobox", { name: "基準", exact: true }),
	).toHaveCount(0);
	await reviewMatchSelection(page, root, label);
	if (width < 1000) {
		await page
			.getByRole("button", { name: "シミュレーション", exact: true })
			.click();
	}
	await page.getByRole("button", { name: "検査", exact: true }).click();
	await page.getByText("判定結果", { exact: true }).waitFor();
	await page.screenshot({ path: `${root}/${label}-simulation.png` });
	if (width < 1000) {
		await page.getByRole("button", { name: "編集", exact: true }).click();
	}
	assert.equal(
		await page
			.getByRole("textbox", { name: "ID", exact: true })
			.inputValue(),
		"review-env",
	);
	const geometry = await page.evaluate(() => ({
		theme: globalThis.document.documentElement.dataset.storybookTheme,
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		background: globalThis.getComputedStyle(
			globalThis.document.querySelector("main"),
		).backgroundColor,
		foreground: globalThis.getComputedStyle(
			globalThis.document.querySelector("main"),
		).color,
	}));
	assert.ok(geometry.scrollWidth <= width);
	return geometry;
}

/** 同じストーリーを明暗・幅別に撮影し、実行時エラーと変更後の操作を確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/guardrails-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (
				message.type() === "error" ||
				message.text().includes("derived_inert")
			) {
				errors.push(message.text());
			}
		});
		for (const [theme, width] of [
			["dark2026", 1200],
			["dark2026", 520],
			["dark2026", 360],
			["light", 1200],
			["light", 520],
			["light", 360],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=pi-guardrails--editor&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("heading", { name: "Pi ガードレール" })
				.waitFor();
			const label = `${theme}-${width}`;
			if (phase === "after") {
				results.push(await reviewEditing(page, root, label, width));
			}
			await page.screenshot({ path: `${root}/${label}.png` });
			if (phase === "after") {
				await reviewBuiltins(page, root, label);
			}
			if (phase === "after" && width === 360) {
				await reviewTabs(page, root, label);
				await reviewDeletionControls(page, root, label);
			}
		}
		if (phase === "after") {
			await page.setViewportSize({ width: 900, height: 950 });
			await page.goto(
				"http://localhost:6006/iframe.html?id=agent-manager--codex&viewMode=story&globals=theme:dark2026",
			);
			const nav = page.getByRole("navigation", { name: "管理対象" });
			await expect(
				nav.getByRole("button", { name: "Agents", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await page.screenshot({ path: `${root}/agent-manager-agents.png` });
			await nav
				.getByRole("button", { name: "ハンドオフ", exact: true })
				.click();
			await expect(
				nav.getByRole("button", { name: "ハンドオフ", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await page.screenshot({
				path: `${root}/agent-manager-handoff.png`,
			});
		}
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors, results }, null, 2),
		);
		assert.deepEqual(errors, []);
		console.log(root);
	} finally {
		await browser.close();
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
