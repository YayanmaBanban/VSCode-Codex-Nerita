// 項目の説明・選択チェック・ホバーと context ツールチップを検証する。
import { expectSent, showState } from "../storyBridge";
import { settingsFixture } from "../../fixtures/settingsFixture";
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`設定一覧とツールチップ: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		const storybookTheme = theme === "dark" ? "dark2026" : "light";
		await page.goto(
			`/iframe.html?id=chat-composer-settings--connected&viewMode=story&globals=theme:${storybookTheme}`,
		);
		const model = page.getByRole("combobox", {
			name: "Model",
			exact: true,
		});
		await page.getByRole("button", { name: "モデルと推論レベル" }).click();
		await model.click();
		const selected = page.getByRole("option", {
			name: "6 Astra",
			exact: true,
		});
		const other = page.getByRole("option", {
			name: "5.6 Luna",
			exact: true,
		});
		await expect(selected).toHaveAttribute("aria-selected", "true");
		await expect(other).toHaveAttribute("aria-selected", "false");
		await other.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"Fast and affordable agentic coding model.",
		);
		await info.attach("model-menu-hover", {
			body: await page.screenshot({
				path: info.outputPath("model-menu.png"),
			}),
			contentType: "image/png",
		});
		await other.click();
		await expectSent(page, {
			type: "config/set",
			configId: "model",
			value: "gpt-5.6-luna",
		});
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "model"
					? { ...option, currentValue: "gpt-5.6-luna" }
					: option,
			),
		});
		await expect(model).toHaveText("5.6 Luna");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await model.focus();
		await page.keyboard.press("ArrowDown");
		await expect(
			page.getByRole("option", { name: "5.6 Luna", exact: true }),
		).toHaveAttribute("aria-selected", "true");
		await expect(other).toBeFocused();
		await page.keyboard.press("Home");
		await expect(selected).toBeFocused();
		await page.keyboard.press("Enter");
		await expectSent(page, {
			type: "config/set",
			configId: "model",
			value: "gpt-6-astra",
		});
		await showState(page, { configOptions: settingsFixture() });
		await expect(model).toHaveText("6 Astra");
		await page.getByRole("button", { name: "使用量60%" }).click();
		const context = page.getByRole("progressbar");
		await context.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"context0.6K/1K (60%)",
		);
		await info.attach("context-tooltip", {
			body: await page.screenshot({
				path: info.outputPath("context.png"),
			}),
			contentType: "image/png",
		});
		await page.keyboard.press("Escape");
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await page.getByRole("button", { name: "モデルと推論レベル" }).click();
		await page.getByRole("switch", { name: "ファストモード" }).hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"ファストモード\n速度1.5倍、使用量が増えます",
		);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		expect(errors).toEqual([]);
	});
}
