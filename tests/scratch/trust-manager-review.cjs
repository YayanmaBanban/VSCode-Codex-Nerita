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
		if (process.argv[2] === "frames") {
			await verifyDisclosureFrames(browser, directory, errors);
			console.log(directory);
			return;
		}
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
			await verifyDisclosureFrames(browser, directory, errors);
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

async function verifyDisclosureFrames(browser, directory, errors) {
	const page = await browser.newPage({
		viewport: { width: 720, height: 800 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(
			"http://localhost:6007/iframe.html?id=trust-manager--default&viewMode=story&globals=theme:dark2026",
		);
		const button = page.getByRole("button", { name: "信頼設定の保存先" });
		const help = page.locator(".storage-help");
		await expect(button).toBeVisible();
		for (const direction of ["open", "close"]) {
			await button.evaluate((element) => element.click());
			await help.evaluate(async (element) => {
				await new Promise((resolve) =>
					globalThis.requestAnimationFrame(resolve),
				);
				await new Promise((resolve) =>
					globalThis.requestAnimationFrame(resolve),
				);
				for (const animation of element.getAnimations()) {
					animation.pause();
				}
			});
			const heights = [];
			for (const time of [0, 48, 120, 220, 240]) {
				const height = await help.evaluate((element, currentTime) => {
					for (const animation of element.getAnimations()) {
						animation.currentTime = currentTime;
					}
					return element.getBoundingClientRect().height;
				}, time);
				heights.push(height);
				await page.screenshot({
					path: join(directory, `help-${direction}-${time}.png`),
				});
			}
			verifyHeightProgress(heights, direction);
			await help.evaluate(async (element) => {
				const animations = element.getAnimations();
				for (const animation of animations) {
					animation.currentTime = 0;
					animation.play();
				}
				await Promise.all(
					animations.map((animation) => animation.finished),
				);
			});
			await expect
				.poll(() =>
					help.evaluate((element) => element.getAnimations().length),
				)
				.toBe(0);
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await button.click();
		await expect(button).toHaveAttribute("aria-expanded", "true");
		expect(
			await help.evaluate((element) => element.getAnimations().length),
		).toBe(0);
		await page.getByRole("combobox", { name: "バックエンド" }).focus();
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Home");
		await page.keyboard.press("Enter");
		await expect(help).toContainText("config.toml");
		await expect(help).not.toContainText("state.vscdb");
	} finally {
		await page.close();
	}
}

function verifyHeightProgress(heights, direction) {
	// ease-out の終端ではサブピクセルが丸められるため、停滞は許容して逆行を拒否する。
	expect(heights[2]).toBeGreaterThan(0);
	expect(heights[2]).toBeLessThan(Math.max(heights[0], heights.at(-1)));
	for (let index = 1; index < heights.length; index++) {
		if (direction === "open") {
			expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1]);
		} else {
			expect(heights[index]).toBeLessThanOrEqual(heights[index - 1]);
		}
	}
}

async function verifyHelp(page, directory, name, backend) {
	const button = page.getByRole("button", { name: "信頼設定の保存先" });
	const help = page.locator(".storage-help");
	await expect(button).toHaveAttribute("aria-expanded", "false");
	await button.click();
	await expect(button).toHaveAttribute("aria-expanded", "true");
	await expect(help).toContainText(
		backend === "codex" ? "config.toml" : "User/globalStorage/state.vscdb",
	);
	await expect
		.poll(() => help.evaluate((element) => element.getAnimations().length))
		.toBe(0);
	await page.screenshot({
		path: join(directory, `${name}-help.png`),
		fullPage: true,
	});
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
	await button.click();
	await expect(button).toHaveAttribute("aria-expanded", "false");
	await expect
		.poll(() =>
			help.evaluate((element) => element.getBoundingClientRect().height),
		)
		.toBe(0);
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
