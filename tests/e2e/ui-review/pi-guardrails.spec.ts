// 新規エディターの明暗・狭幅表示と、編集から検査・保存・適用までを確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	for (const width of [320, 1100]) {
		test(`guardrails ${theme} ${width}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(
				"/iframe.html?id=pi-guardrails--editor&viewMode=story",
			);
			await expect(
				page.getByRole("heading", {
					name: "Pi ガードレール",
					exact: true,
				}),
			).toBeVisible();
			const summary = page.locator("summary").first();
			await summary.click();
			await expect(page.locator("details").first()).not.toHaveAttribute(
				"open",
			);
			await summary.focus();
			await page.keyboard.press("Enter");
			await expect(page.locator("details").first()).toHaveAttribute(
				"open",
				"",
			);
			const outside = page.getByLabel("workspace外の読取り");
			const border = await outside.evaluate(
				(el) => getComputedStyle(el).borderColor,
			);
			await outside.hover();
			expect(
				await outside.evaluate(
					(el) => getComputedStyle(el).borderColor,
				),
			).not.toBe(border);
			await page
				.getByRole("button", { name: "検査", exact: true })
				.click();
			await page.getByText("判定: deny").scrollIntoViewIfNeeded();
			await expect(page.getByText("判定: deny")).toBeVisible();
			await page.screenshot({
				path: info.outputPath("inspection.png"),
				fullPage: true,
			});
			await page.getByRole("button", { name: "コマンドを追加" }).click();
			const command = page.getByLabel("含まれる文字列");
			await command.fill("");
			await expect(command).toBeVisible();
			await command.fill("git clean -fdx");
			for (const card of await page
				.locator(".guardrails-rule-card")
				.all()) {
				const heading = card.locator("summary");
				await heading.click();
				await expect(card).not.toHaveAttribute("open");
				await heading.focus();
				await page.keyboard.press("Enter");
				await expect(card).toHaveAttribute("open", "");
			}
			const inner = page.locator(".guardrails-rule-content").first();
			await expect(inner).toHaveCSS("overscroll-behavior-y", "auto");
			const outer = page.locator(".guardrails-scroll").first();
			await inner.evaluate((el) => {
				el.scrollTop = el.scrollHeight;
			});
			await outer.evaluate((el) => {
				el.scrollTop = 0;
			});
			const innerBox = await inner.boundingBox();
			const outerBox = await outer.boundingBox();
			if (innerBox && outerBox) {
				await page.mouse.move(
					innerBox.x + 5,
					Math.min(
						innerBox.y + innerBox.height,
						outerBox.y + outerBox.height,
					) - 10,
				);
				await page.mouse.wheel(0, 300);
				await expect
					.poll(() => outer.evaluate((el) => el.scrollTop))
					.toBeGreaterThan(0);
			}
			await expect(page.getByTestId("unsaved-beam")).toBeAttached();
			await expect(
				page.getByRole("button", { name: "保存", exact: true }),
			).toBeEnabled();
			const beam = page.getByTestId("unsaved-beam").locator("div").last();
			const offset = await beam.evaluate(
				(el) => getComputedStyle(el).offsetDistance,
			);
			await expect
				.poll(() =>
					beam.evaluate((el) => getComputedStyle(el).offsetDistance),
				)
				.not.toBe(offset);
			const save = page.getByRole("button", {
				name: "保存",
				exact: true,
			});
			const before = await save.boundingBox();
			await page
				.locator(".guardrails-scroll")
				.first()
				.evaluate((el) => {
					el.scrollTop = el.scrollHeight;
				});
			expect(await save.boundingBox()).toEqual(before);
			const smallFonts = await page
				.locator("main *")
				.evaluateAll((elements) =>
					elements
						.filter(
							(el) =>
								el.getClientRects().length &&
								parseFloat(getComputedStyle(el).fontSize) < 12,
						)
						.map((el) => el.tagName),
				);
			expect(smallFonts).toEqual([]);
			await page.screenshot({ path: info.outputPath("unsaved.png") });
			await page
				.getByRole("button", { name: "保存", exact: true })
				.click();
			await expect(
				page.locator('main[data-document-status="保存済み・未適用"]'),
			).toBeVisible();
			await expect(page.getByTestId("unsaved-beam")).toHaveCount(0);
			await page
				.getByRole("button", { name: "適用", exact: true })
				.click();
			await expect(
				page.locator('main[data-document-status="適用済み"]'),
			).toBeVisible();
			await page.getByRole("switch", { name: "JSONで編集" }).click();
			const json = page.getByLabel("設定JSON");
			const original = await json.inputValue();
			await json.fill("{ invalid }");
			await page
				.getByRole("button", { name: "検査", exact: true })
				.click();
			await expect(page.getByRole("alert")).toBeVisible();
			await page.screenshot({
				path: info.outputPath("invalid-json.png"),
				fullPage: true,
			});
			await json.fill(original);
			await page
				.getByRole("button", { name: "保存", exact: true })
				.click();
			await page.getByRole("switch", { name: "JSONで編集" }).click();
			await expect(page.getByLabel("含まれる文字列")).toHaveValue(
				"git clean -fdx",
			);
			await page
				.getByRole("button", { name: "検査", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await expect(page.getByText("判定: deny")).toBeVisible();
			await info.attach("final", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						window.innerWidth,
				),
			).toBe(true);
			expect(errors).toEqual([]);
		});
	}
}
