// Storybook の信頼管理を明暗・狭幅で撮影する。node tests/scratch/trust-manager-review.cjs after で実行する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

async function main() {
	const directory = join(
		"dist/ui-review",
		`trust-manager-${process.argv[2] ?? "review"}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const backends =
		process.argv[2] === "before" ? ["default"] : ["default", "codex"];
	const conditions = ["dark2026", "light"].flatMap((theme) =>
		[320, 900].map((width) => ({ theme, width })),
	);
	try {
		for (const condition of conditions) {
			for (const backend of backends) {
				await capture(
					browser,
					{ ...condition, backend, directory },
					errors,
				);
			}
		}
		if (process.argv[2] !== "before") {
			await verifyHold(browser, directory, errors);
		}
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

async function capture(browser, { theme, width, backend, directory }, errors) {
	const page = await browser.newPage({ viewport: { width, height: 950 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`http://localhost:6007/iframe.html?id=trust-manager--${backend}&viewMode=story&globals=theme:${theme}`,
		);
		await expect(page.getByRole("article")).toHaveCount(3);
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${backend}.png`),
			fullPage: true,
		});
		await verifyHelp(
			page,
			directory,
			`${theme}-${width}-${backend}`,
			backend,
		);
		if (backend === "codex") {
			await verifyCodexActions(page, directory, `${theme}-${width}`);
		}
		if (process.argv[2] !== "before") {
			await verifyToolbar(
				page,
				directory,
				`${theme}-${width}-${backend}`,
			);
		}
	} catch (error) {
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${backend}-failed.png`),
			fullPage: true,
		});
		throw error;
	} finally {
		await page.close();
	}
}

async function verifyCodexActions(page, directory, name) {
	const order = await page
		.getByRole("article")
		.getByRole("heading")
		.allTextContents();
	const record = page
		.getByRole("article")
		.filter({ hasText: "projects/codex-unset" });
	await record.getByRole("button", { name: "信頼する", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	await page.screenshot({
		path: join(directory, `${name}-trust-confirmation.png`),
		fullPage: true,
	});
	await page
		.getByRole("button", { name: "このフォルダを信頼する", exact: true })
		.click();
	expect(await lastRequest(page)).toMatchObject({
		type: "trust",
		root: "projects/codex-unset",
		backend: "codex",
	});
	await record
		.getByRole("button", { name: "信頼を取り消す", exact: true })
		.click();
	expect(await lastRequest(page)).toMatchObject({
		type: "revoke",
		root: "projects/codex-unset",
		backend: "codex",
	});
	expect(
		await page.getByRole("article").getByRole("heading").allTextContents(),
	).toEqual(order);
	await page.getByRole("combobox", { name: "バックエンド" }).click();
	await page.getByRole("option", { name: "Pi", exact: true }).click();
	expect(await lastRequest(page)).toMatchObject({
		type: "refresh",
		backend: "pi",
	});
	await expect(
		page
			.getByRole("article")
			.filter({ hasText: "projects/current-project" }),
	).toHaveCount(1);
}

function lastRequest(page) {
	return page
		.locator("[data-story-trust]")
		.evaluate((element) => element.sent.at(-1));
}

async function verifyToolbar(page, directory, name) {
	for (const label of ["ワークスペースの追加", "再読み込み"]) {
		const button = page.getByRole("button", { name: label, exact: true });
		expect((await button.textContent()).trim()).toBe("");
		await verifyHighlight(page, button);
		await button.hover();
		await expect(page.getByRole("tooltip", { name: label })).toBeVisible();
		await page.screenshot({
			path: join(directory, `${name}-${label}.png`),
			fullPage: true,
		});
		await button.click();
		expect(await lastRequest(page)).toMatchObject({
			type: label === "再読み込み" ? "refresh" : "add",
		});
	}
	const search = page.getByRole("searchbox", { name: "フォルダを検索" });
	await search.fill("current-project");
	await expect(page.getByRole("article")).toHaveCount(1);
	await search.fill("");
	await expect(page.getByRole("article")).toHaveCount(3);
	expect(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth >
				globalThis.innerWidth,
		),
	).toBe(false);
}

async function verifyHighlight(page, button) {
	await page.mouse.move(0, 0);
	const normal = await button.evaluate(
		(element) => globalThis.getComputedStyle(element).backgroundColor,
	);
	await button.hover();
	const hovered = await button.evaluate(
		(element) => globalThis.getComputedStyle(element).backgroundColor,
	);
	expect(hovered).not.toBe(normal);
	expect(hovered).not.toBe("rgba(0, 0, 0, 0)");
}

async function verifyHelp(page, directory, name, backend) {
	const button = page.getByRole("button", { name: "信頼設定の保存先" });
	await button.focus();
	const help = page.getByRole("tooltip");
	await expect(help).toBeVisible();
	await expect(help).toContainText(
		backend === "codex" ? "config.toml" : "User/globalStorage/state.vscdb",
	);
	await page.screenshot({
		path: join(directory, `${name}-help.png`),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await expect(help).not.toBeVisible();
	await page.getByRole("combobox", { name: "バックエンド" }).click();
	await expect(
		page.getByRole("option", { name: "Codex", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: "Pi", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: join(directory, `${name}-backend-menu.png`),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	const trust = page
		.getByRole("button", { name: "信頼する", exact: true })
		.and(page.locator("button:enabled"))
		.first();
	await verifyHighlight(page, trust);
}

async function verifyHold(browser, directory, errors) {
	const page = await browser.newPage({
		viewport: { width: 720, height: 800 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.clock.install();
		await page.goto(
			"http://localhost:6007/iframe.html?id=trust-manager--codex&viewMode=story&globals=theme:dark2026",
		);
		await expect(page.getByRole("article")).toHaveCount(3);
		await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
		const button = page
			.getByRole("article")
			.filter({ hasText: "projects/codex-unset" })
			.getByRole("button", { name: /削除/ });
		await button.click();
		await page.clock.runFor(2100);
		expect(await removals(page)).toHaveLength(0);
		await beginHold(page, button);
		await page.clock.runFor(500);
		await page.mouse.move(0, 0);
		await page.mouse.up();
		await page.clock.runFor(2200);
		expect(await removals(page)).toHaveLength(0);
		await beginHold(page, button);
		await page.clock.runFor(500);
		const search = page.getByRole("searchbox", {
			name: "フォルダを検索",
		});
		await search.fill("trusted");
		await page.clock.runFor(2200);
		expect(await removals(page)).toHaveLength(0);
		await search.fill("");
		await beginHold(page, button);
		let previous = 0;
		for (const time of [0, 250, 1000, 1750, 1999]) {
			await page.clock.runFor(time - previous);
			await setAnimationTime(button, time);
			await page.screenshot({
				path: join(directory, `hold-${time}.png`),
			});
			expect(await removals(page)).toHaveLength(0);
			previous = time;
		}
		await page.clock.runFor(1);
		expect(await removals(page)).toHaveLength(1);
		expect((await removals(page))[0]).toMatchObject({
			type: "remove",
			root: "projects/codex-unset",
			backend: "codex",
		});
		await page.mouse.up();
		await page.clock.runFor(2200);
		expect(await removals(page)).toHaveLength(1);
		await page.screenshot({ path: join(directory, "hold-completed.png") });
	} finally {
		await page.close();
	}
}

async function beginHold(page, button) {
	const bounds = await button.boundingBox();
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await page.mouse.down();
}

function removals(page) {
	return page
		.locator("[data-story-trust]")
		.evaluate((element) =>
			element.sent.filter((request) => request.type === "remove"),
		);
}

async function setAnimationTime(button, time) {
	const progress = await button.evaluate((element, currentTime) => {
		for (const animation of element.getAnimations({ subtree: true })) {
			animation.pause();
			animation.currentTime = currentTime;
		}
		return new globalThis.DOMMatrixReadOnly(
			globalThis.getComputedStyle(element.querySelector(".hold-curtain"))
				.transform,
		).a;
	}, time);
	expect(progress).toBeCloseTo(time / 2000, 2);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
