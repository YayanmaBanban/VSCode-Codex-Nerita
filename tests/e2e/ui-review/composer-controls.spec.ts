// ブロックのホイール境界と削除ボタンを、実際のスクロール・履歴で検証する。
import { test, expect } from "@playwright/test";
import { select, paste } from "./composerHelpers";

for (const colorScheme of ["dark", "light"] as const) {
	test(`コード削除・Undo・キーボード操作: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("前文後文");
		await select(input, 2);
		const long = "const value = 123;\n".repeat(100);
		await paste(input, long);
		const code = input.locator("pre");
		const remove = page.getByRole("button", {
			name: "コードブロックを削除",
		});
		const top = await remove.boundingBox();
		await code.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		expect((await remove.boundingBox())?.y).toBe(top?.y);
		await page.screenshot({
			path: info.outputPath(`remove-${colorScheme}.png`),
		});
		await remove.click();
		await expect(code).toHaveCount(0);
		await expect(input).toHaveText("前文後文");
		await expect(input).toBeFocused();
		await input.press("Control+z");
		await expect(code).toHaveText(long, { useInnerText: true });
		await remove.focus();
		await remove.press("Enter");
		await expect(code).toHaveCount(0);
		await expect(input).toHaveText("前文後文");
		await expect(page.getByRole("log")).toBeEmpty();
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toHaveText("前文後文");
		expect(errors).toEqual([]);
	});
}

test("ホイールでブロック内部から全体へ上下にスクロールをつなぐ", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	const before = "前の文章\n".repeat(20);
	await input.fill(before + "後の文章\n".repeat(30));
	await select(input, before.length);
	await paste(input, "const sample = 'ログ';\n".repeat(100));
	const code = input.locator("pre");
	await input.evaluate((root) => {
		const block = root.querySelector(".composer-code-block")!;
		root.scrollTop +=
			block.getBoundingClientRect().top -
			root.getBoundingClientRect().top -
			40;
	});
	await code.evaluate((node) => {
		node.scrollTop = 100;
	});
	await code.hover();
	const outerStart = await input.evaluate((node) => node.scrollTop);
	const caret = await page.evaluate(() => ({
		node: window.getSelection()?.anchorNode?.textContent,
		offset: window.getSelection()?.anchorOffset,
	}));
	await page.mouse.wheel(0, 80);
	await expect
		.poll(() => code.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(100);
	expect(await input.evaluate((node) => node.scrollTop)).toBe(outerStart);
	await code.evaluate((node) => {
		node.scrollTop = node.scrollHeight;
	});
	await page.mouse.wheel(0, 100);
	await expect
		.poll(() => input.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(outerStart);
	await input.evaluate((root) => {
		const block = root.querySelector(".composer-code-block")!;
		root.scrollTop +=
			block.getBoundingClientRect().top -
			root.getBoundingClientRect().top -
			40;
	});
	await code.evaluate((node) => {
		node.scrollTop = 0;
	});
	await code.hover();
	const outerBeforeUp = await input.evaluate((node) => node.scrollTop);
	await page.mouse.wheel(0, -100);
	await expect
		.poll(() => input.evaluate((node) => node.scrollTop))
		.toBeLessThan(outerBeforeUp);
	expect(
		await page.evaluate(() => ({
			node: window.getSelection()?.anchorNode?.textContent,
			offset: window.getSelection()?.anchorOffset,
		})),
	).toEqual(caret);
	await page.screenshot({ path: info.outputPath("wheel-boundary.png") });
	expect(errors).toEqual([]);
});
