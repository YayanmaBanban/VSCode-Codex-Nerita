// ケースの選択実行: pnpm test:scratch guardrails-layout-review.spec.cjs --grep "ケース名"
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 両端の送り、リサイズ後の再判定、隠れていた項目の選択とフォーカス表示を確認する。 */
async function reviewTabs(page, root, label) {
	const nav = page.getByRole("navigation", { name: "ルールのカテゴリ" });
	const left = nav.getByRole("button", { name: "左のタブを表示" });
	const right = nav.getByRole("button", { name: "右のタブを表示" });
	await expect(left).toBeDisabled();
	await right.click();
	await settleTabs(nav);
	if (await right.isEnabled()) {
		await right.click();
		await settleTabs(nav);
	}
	await expect(right).toBeDisabled();
	await nav.getByRole("button", { name: /パス例外/ }).click();
	await expect(
		page.getByRole("heading", { name: "例外 (2)", exact: true }),
	).toBeVisible();
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
	await expect(
		page.getByRole("button", { name: "保存して適用", exact: true }),
	).toBeEnabled();
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

/** 他の項目の削除で選択を失わず、例外タブではルールの削除操作が提供されないことを確認する。 */
async function reviewPathList(page, root, label) {
	const id = page.getByRole("textbox", { name: "ID", exact: true });
	for (const name of ["selected-rule", "long-rule-name-".repeat(4)]) {
		await page.getByRole("button", { name: /ルールを追加/ }).click();
		await id.fill(name);
	}
	const list = page.getByRole("region", { name: "パスルール一覧" });
	await list
		.getByRole("button", { name: "selected-rule", exact: true })
		.focus();
	await page.keyboard.press("Enter");
	await expect(id).toHaveValue("selected-rule");
	const deletion = list.getByRole("button", {
		name: "パスルール 1を削除",
		exact: true,
	});
	await deletion.click();
	await expect(id).toHaveValue("selected-rule");
	await page.screenshot({ path: `${root}/${label}-path-list.png` });
	await deletion.focus();
	await page.keyboard.down("Enter");
	await expect(
		list.getByRole("button", { name: "review-env", exact: true }),
	).toHaveCount(0);
	await page.keyboard.up("Enter");
	await expect(id).toHaveValue("selected-rule");
	await expect(
		list.getByRole("button", { name: "selected-rule", exact: true }),
	).toHaveAttribute("aria-current", "page");
	const nav = page.getByRole("navigation", { name: "ルールのカテゴリ" });
	await nav.getByRole("button", { name: /^パス例外/ }).click();
	await expect(list.getByRole("button", { name: /を削除/ })).toHaveCount(0);
	await expect(
		page.getByRole("combobox", { name: "パスルールを選択" }),
	).toHaveCount(0);
	await list
		.getByRole("button", { name: "long-rule-name-".repeat(4), exact: true })
		.click();
	await page.screenshot({ path: `${root}/${label}-path-exceptions.png` });
	await nav.getByRole("button", { name: /^パスルール/ }).click();
	await expect(id).toHaveValue("long-rule-name-".repeat(4));
	await list
		.getByRole("button", { name: "selected-rule", exact: true })
		.click();
	const selectedDeletion = list.getByRole("button", {
		name: "パスルール 1を削除",
		exact: true,
	});
	await selectedDeletion.focus();
	await page.keyboard.down("Enter");
	await expect(
		list.getByRole("button", { name: "selected-rule", exact: true }),
	).toHaveCount(0);
	await page.keyboard.up("Enter");
	await expect(id).toHaveValue("long-rule-name-".repeat(4));
	await page.screenshot({ path: `${root}/${label}-path-deleted.png` });
}

/** 広い画面では検索サイドバー、狭い画面では従来の選択欄と削除ボタンを表示する。 */
async function reviewPathPicker(page, width) {
	const picker = page.getByRole("combobox", {
		name: "パスルールを選択",
		exact: true,
	});
	if (width >= 1000) {
		await expect(picker).toHaveCount(0);
		await expect(
			page.getByRole("region", { name: "パスルール一覧" }),
		).toBeVisible();
	} else {
		const field = await picker.boundingBox();
		const deletion = await page
			.getByRole("button", { name: "パスルール 1を削除", exact: true })
			.boundingBox();
		assert.ok(Math.abs(field.height - deletion.height) < 1);
		await expect(
			page.getByRole("searchbox", { name: "パスルールを検索" }),
		).toHaveCount(0);
	}
}

/** 狭い画面の切替を経ても入力が残り、検査結果を確認できることを検証する。 */
async function reviewEditing(page, root, label, width) {
	await page
		.getByRole("textbox", { name: "ID", exact: true })
		.fill("review-env");
	await reviewPathPicker(page, width);
	const id = await page
		.getByRole("textbox", { name: "ID", exact: true })
		.boundingBox();
	const action = await page
		.getByRole("combobox", { name: "判定", exact: true })
		.boundingBox();
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

/** ケースごとに初期の編集画面を開き、ほかの操作で作られた状態に依存させない。 */
async function openEditor(page, theme, width) {
	await page.setViewportSize({ width, height: 950 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=pi-guardrails--editor&viewMode=story&globals=theme:${theme}`,
	);
	await expect(
		page.getByRole("heading", { name: "Pi ガードレール" }),
	).toBeVisible();
}
for (const width of [360, 520, 1200]) {
	test(`ガードレール: 編集・シミュレーション切替で入力を保持する dark2026 ${width} @behavior @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const root = testInfo.outputPath("review");
		await fs.mkdir(root, { recursive: true });
		const page = await browser.newPage();
		await openEditor(page, "dark2026", width);
		const geometry = await reviewEditing(
			page,
			root,
			`dark2026-${width}`,
			width,
		);
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify(geometry, null, 2),
		);
	});
}
for (const [name, width, review] of [
	["照合のメニューを繰り返し開く", 1200, reviewMatchSelection],
	["組み込みルールを切り替える", 1200, reviewBuiltins],
	["他の項目を削除しても選択を保持する", 1200, reviewPathList],
	["狭幅タブの送りとリサイズに追従する", 360, reviewTabs],
	["例外削除とコマンドの長押しを区別する", 360, reviewDeletionControls],
]) {
	test(`ガードレール: ${name} @behavior`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const root = testInfo.outputPath("review");
		await fs.mkdir(root, { recursive: true });
		const page = await browser.newPage();
		await openEditor(page, "dark2026", width);
		await page
			.getByRole("textbox", { name: "ID", exact: true })
			.fill("review-env");
		await review(page, root, `dark2026-${width}`);
	});
}
for (const theme of ["dark2026", "light"]) {
	for (const width of [360, 520, 1200]) {
		test(`ガードレール: 初期画面の横はみ出しと外観 ${theme} ${width} @layout @visual`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			const page = await browser.newPage();
			await openEditor(page, theme, width);
			assert.equal(
				await page.evaluate(
					() =>
						globalThis.document.documentElement.scrollWidth >
						globalThis.innerWidth,
				),
				false,
			);
			await page.screenshot({ path: testInfo.outputPath("editor.png") });
		});
	}
}
test("Agent Manager: 管理対象タブを切り替える @behavior", async ({
	reviewBrowser: browser,
}, testInfo) => {
	const page = await browser.newPage({
		viewport: { width: 900, height: 950 },
	});
	await page.goto(
		"http://localhost:6006/iframe.html?id=agent-manager--codex&viewMode=story&globals=theme:dark2026",
	);
	const nav = page.getByRole("navigation", { name: "管理対象" });
	await expect(
		nav.getByRole("button", { name: "Agents", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await page.screenshot({
		path: testInfo.outputPath("agent-manager-agents.png"),
	});
	await nav.getByRole("button", { name: "ハンドオフ", exact: true }).click();
	await expect(
		nav.getByRole("button", { name: "ハンドオフ", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await page.screenshot({
		path: testInfo.outputPath("agent-manager-handoff.png"),
	});
});
