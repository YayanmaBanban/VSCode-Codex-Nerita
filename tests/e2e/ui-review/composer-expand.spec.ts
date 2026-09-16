// 入力欄の拡張・復帰で、下書きと編集状態を保ちつつ上方向へ広がることを確認する。
import { test, expect } from "@playwright/test";
import { paste, select } from "./composerHelpers";

for (const colorScheme of ["dark", "light"] as const) {
	test(`入力欄を上へ拡張して元のサイズへ戻す: ${colorScheme}`, async ({
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
		const expand = page.getByRole("button", {
			name: "入力エリアを拡張",
			exact: true,
		});
		await expect(expand.locator("svg")).toHaveClass(/lucide-maximize-2/);
		await input.fill("前後");
		await select(input, 1);
		await paste(input, "const sample = 'コード';\n".repeat(60));
		const text = await input.innerText();
		const before = await input.boundingBox();
		const toggleBox = await expand.boundingBox();
		expect(
			before && toggleBox && before.x + before.width < toggleBox.x,
		).toBe(true);
		await page.screenshot({
			path: info.outputPath(`normal-${colorScheme}.png`),
		});
		await expand.click();
		const collapse = page.getByRole("button", {
			name: "入力エリアを元のサイズに戻す",
		});
		await expect(collapse).toHaveAttribute("aria-expanded", "true");
		const enlarged = await input.boundingBox();
		expect(enlarged!.height - before!.height).toBeGreaterThan(200);
		expect(enlarged!.y).toBeLessThan(before!.y);
		expect(
			Math.abs(
				enlarged!.y + enlarged!.height - before!.y - before!.height,
			),
		).toBeLessThan(2);
		await expect(input).toHaveText(text, { useInnerText: true });
		await expect(input).toBeFocused();
		await expect(
			page.getByRole("button", { name: "送信", exact: true }),
		).toBeInViewport();
		await page.screenshot({
			path: info.outputPath(`expanded-${colorScheme}.png`),
		});
		await collapse.click();
		await expect(expand).toHaveAttribute("aria-expanded", "false");
		expect((await input.boundingBox())!.height).toBe(before!.height);
		await expect(input).toHaveText(text, { useInnerText: true });
		await page.keyboard.insertText("追記");
		await expect(input.locator("p").last()).toHaveText("追記後");
		await input.press("Control+z");
		await expect(input.locator("p").last()).toHaveText("後");
		await expect(input.locator("pre")).toHaveCount(1);
		await expect(page.getByRole("log")).toBeEmpty();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("低い画面でも拡張ボタンをキーボードで切り替えられる", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 320, height: 480 });
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("入力内容を保持");
	const expand = page.getByRole("button", {
		name: "入力エリアを拡張",
		exact: true,
	});
	await expand.focus();
	await expand.press("Enter");
	const collapse = page.getByRole("button", {
		name: "入力エリアを元のサイズに戻す",
	});
	await expect(collapse).toBeFocused();
	await expect(collapse).toBeInViewport();
	await expect(
		page.getByRole("button", { name: "送信", exact: true }),
	).toBeInViewport();
	await expect(input).toHaveText("入力内容を保持");
	await expect(page.getByRole("log")).toBeEmpty();
	await page.screenshot({ path: info.outputPath("expanded-short.png") });
	await collapse.press("Space");
	await expect(expand).toHaveAttribute("aria-expanded", "false");
});
