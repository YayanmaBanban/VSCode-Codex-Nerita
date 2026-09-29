// 設定順・選択値・添付・使用量アニメーションを明暗テーマで確認する。
import { expectSent, showState } from "../storyBridge";
import { settingsFixture } from "../../fixtures/settingsFixture";
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`計画本文を返信欄へ表示: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(
			`/iframe.html?id=chat-composer-settings--proposed-plan&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		await expect(
			page.getByRole("heading", { name: "認証機能の実装計画" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.locator(".message.assistant")).toContainText(
			"回帰テストを追加して検証する。",
		);
		await info.attach("proposed-plan", {
			body: await page.screenshot({
				path: info.outputPath("proposed-plan.png"),
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
	test(`入力欄の設定と使用量: ${theme}`, async ({ page }, info) => {
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
			reducedMotion: "no-preference",
		});
		await page.goto(
			`/iframe.html?id=chat-composer-settings--connected&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		await expect(
			page.getByRole("combobox", { name: "Collaboration mode" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: "Mode", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "モデルと推論レベル" }),
		).toHaveText("6 Astra low");
		expect(
			await page
				.locator(".settings-toolbar > *")
				.evaluateAll((elements: Element[]) =>
					elements.map((el) => el.classList.item(0)),
				),
		).toEqual(["attach-button", "context-usage", "contents"]);
		await expect(
			page.locator(".config-control .lucide-chevron-down"),
		).toHaveCount(1);
		const mode = page.getByRole("button", { name: "Mode", exact: true });
		await mode.hover();
		await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1");
		await expect(
			page.getByRole("tooltip").locator(".lucide-user"),
		).toBeVisible();
		await expect(page.getByRole("tooltip")).toContainText(
			"ワークスペース内に書き込み",
		);
		await info.attach("mode-hover", {
			body: await page.screenshot({
				path: info.outputPath("mode-hover.png"),
			}),
			contentType: "image/png",
		});
		await mode.click();
		const slider = page.getByRole("slider", { name: "Mode" });
		await expect(slider).toHaveAttribute(
			"aria-valuetext",
			"ワークスペース内に書き込み",
		);
		await page.getByRole("combobox", { name: "ApprovalsReviewer" }).hover();
		await expect(
			page.getByRole("tooltip", { name: "ユーザが承認", exact: true }),
		).toBeVisible();
		await page.getByRole("combobox", { name: "ApprovalsReviewer" }).click();
		await expect(
			page.getByRole("option").filter({ hasText: "代わりに承認" }),
		).toContainText("追加のトークンを使用します。");
		await info.attach("reviewer-options", {
			body: await page.screenshot({
				path: info.outputPath("reviewer-options.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("option", { name: /代わりに承認/ }).click();
		await expectSent(page, {
			type: "config/set",
			configId: "approvals_reviewer",
			value: "auto_review",
		});
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "approvals_reviewer"
					? { ...option, currentValue: "auto_review" }
					: option,
			),
		});
		await expect(
			page
				.getByRole("combobox", { name: "ApprovalsReviewer" })
				.locator("svg"),
		).toHaveClass(/lucide-bot/);
		await info.attach("write-card", {
			body: await page.screenshot({
				path: info.outputPath("write-card.png"),
			}),
			contentType: "image/png",
		});
		for (const [key, value, label] of [
			["Home", "read-only", "読み取り専用"],
			["End", "danger-full-access", "フルアクセス"],
		] as const) {
			await slider.focus();
			await slider.press(key);
			await expectSent(page, {
				type: "config/set",
				configId: "mode",
				value,
			});
			await showState(page, {
				configOptions: settingsFixture().map((option) =>
					option.id === "mode"
						? { ...option, currentValue: value }
						: option,
				),
			});
			await expect(slider).toHaveAttribute("aria-valuetext", label);
			await expect(
				page.getByRole("heading", { name: label, exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("combobox", { name: "ApprovalsReviewer" }),
			).toHaveCount(0);
			await info.attach(value, {
				body: await page.screenshot({
					path: info.outputPath(`${value}.png`),
				}),
				contentType: "image/png",
			});
		}
		await expect(mode.locator("svg")).toHaveClass(/lucide-shield-alert/);
		await slider.press("Escape");
		await expect(slider).toHaveCount(0);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await expect(
			page.getByRole("option", { name: "Goal", exact: true }),
		).toBeVisible();
		await info.attach("collaboration-options", {
			body: await page.screenshot({
				path: info.outputPath("collaboration-options.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("option", { name: "Plan", exact: true }).click();
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "collaboration_mode"
					? { ...option, currentValue: "plan" }
					: option,
			),
		});
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"plan"',
		);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await page.getByRole("option", { name: "Goal", exact: true }).click();
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "collaboration_mode"
					? { ...option, currentValue: "goal" }
					: option,
			),
		});
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"goal"',
		);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await page
			.getByRole("option", { name: "Default", exact: true })
			.click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"default"',
		);
		await page.getByRole("button", { name: "モデルと推論レベル" }).click();
		const reasoning = page.getByRole("slider", {
			name: "Reasoning effort",
		});
		const bounds = (await reasoning.boundingBox())!;
		const beforeDrag = await page.getByLabel("最後の要求").textContent();
		await page.mouse.move(bounds.x + 18, bounds.y + bounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(
			bounds.x + 18 + (bounds.width - 36) * 0.38,
			bounds.y + bounds.height / 2,
			{ steps: 12 },
		);
		await expect
			.poll(async () => Number(await reasoning.inputValue()))
			.toBeGreaterThan(0.5);
		await expect
			.poll(async () => Number(await reasoning.inputValue()))
			.toBeLessThan(1);
		await expect(reasoning).toHaveAttribute("aria-valuetext", "High");
		await expect(page.getByLabel("最後の要求")).toHaveText(beforeDrag!);
		await info.attach("reasoning-drag", {
			body: await page.screenshot({
				path: info.outputPath("reasoning-drag.png"),
			}),
			contentType: "image/png",
		});
		await page.mouse.up();
		await expectSent(page, {
			type: "config/set",
			configId: "reasoning_effort",
			value: "high",
		});
		await expect(reasoning).toHaveValue("1");
		await page.mouse.move(
			bounds.x + 18 + (bounds.width - 36) / 2,
			bounds.y + bounds.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			bounds.x + bounds.width - 18,
			bounds.y + bounds.height / 2,
			{ steps: 10 },
		);
		await page.mouse.up();
		await expect(reasoning).toHaveValue("2");
		await expect(reasoning).toHaveAttribute("aria-valuetext", "Ultra");
		// Host がまだ Low の間も、描画フレームをまたいで確定位置を保つ。
		const releaseValues = await reasoning.evaluate(async (element) => {
			const values: string[] = [];
			for (let frame = 0; frame < 8; frame++) {
				await new Promise(requestAnimationFrame);
				values.push((element as HTMLInputElement).value);
			}
			return values;
		});
		expect(releaseValues).toEqual(Array(8).fill("2"));
		await info.attach("reasoning-released", {
			body: await page.screenshot({
				path: info.outputPath("reasoning-released.png"),
			}),
			contentType: "image/png",
		});
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "reasoning_effort"
					? { ...option, currentValue: "ultra" }
					: option,
			),
		});
		await expect(reasoning).toHaveValue("2");
		await reasoning.focus();
		await reasoning.press("End");
		await expectSent(page, {
			type: "config/set",
			configId: "reasoning_effort",
			value: "ultra",
		});
		await info.attach("model-card", {
			body: await page.screenshot({
				path: info.outputPath("model-card.png"),
			}),
			contentType: "image/png",
		});
		await page
			.getByRole("combobox", { name: "Model", exact: true })
			.click();
		await page
			.getByRole("option", { name: "5.6 Luna", exact: true })
			.click();
		await expectSent(page, { type: "config/set", configId: "model" });
		await showState(page, {
			configOptions: settingsFixture().map((option) => {
				if (option.id === "reasoning_effort") {
					return {
						...option,
						currentValue: "high",
						options: option.options.filter(
							(choice) => choice.value !== "ultra",
						),
					};
				}
				return option.id === "model"
					? { ...option, currentValue: "gpt-5.6-luna" }
					: option;
			}),
		});
		await expect(reasoning).toHaveAttribute("max", "1");
		await expect(reasoning).toHaveAttribute("aria-valuetext", "High");
		await expect(
			page.getByRole("button", { name: "モデルと推論レベル" }),
		).toHaveText("5.6 Luna high");
		const fastMode = page.getByRole("switch", { name: "ファストモード" });
		await fastMode.hover();
		await expect(page.getByRole("tooltip")).toContainText(
			"速度1.5倍、使用量が増えます",
		);
		await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1");
		await info.attach("fast-mode-hover", {
			body: await page.screenshot({
				path: info.outputPath("fast-mode-hover.png"),
			}),
			contentType: "image/png",
		});
		await fastMode.click();
		await expectSent(page, {
			type: "config/set",
			configId: "fast-mode",
			value: "on",
		});
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"on"',
		);
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "fast-mode"
					? { ...option, currentValue: "on" }
					: option,
			),
		});
		await expect(fastMode).toHaveAttribute("aria-checked", "true");
		const modelTrigger = page.getByRole("button", {
			name: "モデルと推論レベル",
		});
		await expect(modelTrigger.locator(".lucide-zap")).toBeVisible();
		await expect(fastMode.locator("svg")).toHaveAttribute(
			"fill",
			"#FACC15",
		);
		await info.attach("fast-mode-on", {
			body: await page.screenshot({
				path: info.outputPath("fast-mode-on.png"),
			}),
			contentType: "image/png",
		});
		await fastMode.click();
		await expectSent(page, {
			type: "config/set",
			configId: "fast-mode",
			value: "off",
		});
		await reasoning.press("Escape");
		await modelTrigger.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"軽い推論。速度とコストを、優先します。",
		);
		await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1");
		await info.attach("model-trigger-fast", {
			body: await page.screenshot({
				path: info.outputPath("model-trigger-fast.png"),
			}),
			contentType: "image/png",
		});
		await showState(page, { configOptions: settingsFixture() });
		await expect(modelTrigger.locator(".lucide-zap")).toHaveCount(0);
		await showState(page, {
			configOptions: settingsFixture().map((option) =>
				option.id === "reasoning_effort"
					? { ...option, currentValue: "ultra" }
					: option,
			),
		});
		await expect(page.getByRole("tooltip")).toHaveText(
			"複雑な作業を必要に応じて、複数のエージェントへ委譲します。\n使用量が大きく、増える場合があります。",
		);
		await info.attach("model-trigger-ultra", {
			body: await page.screenshot({
				path: info.outputPath("model-trigger-ultra.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "コンテキストを追加" }).hover();
		await expect(
			page.getByRole("tooltip", {
				name: "コンテキストを追加",
				exact: true,
			}),
		).toHaveCSS("opacity", "1");
		await info.attach("attachment-hover", {
			body: await page.screenshot({
				path: info.outputPath("attachment-hover.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "コンテキストを追加" }).click();
		await page
			.getByRole("option", { name: "添付ファイル", exact: true })
			.click();
		await expect(
			page.locator(".attachment .lucide-file-code"),
		).toBeVisible();
		await expect(
			page.locator(".attachment .lucide-file-image"),
		).toBeVisible();
		await page.getByRole("button", { name: "design.png を開く" }).click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"type":"attachment/open"',
		);
		await page.getByRole("button", { name: "使用量40%" }).click();
		const ring = page.locator(".context-fill");
		const offset = () =>
			ring.evaluate((el) =>
				Number(getComputedStyle(el).strokeDashoffset.replace("px", "")),
			);
		await expect.poll(offset).toBeCloseTo(60, 0);
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"data-warning",
			"false",
		);
		await page.getByRole("button", { name: "使用量60%" }).click();
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"600",
		);
		expect(await offset()).toBeGreaterThan(40);
		expect(await offset()).toBeLessThanOrEqual(60);
		await info.attach("usage-increment", {
			body: await page
				.locator(".composer")
				.screenshot({ path: info.outputPath("increment.png") }),
			contentType: "image/png",
		});
		await expect.poll(offset).toBeCloseTo(40, 0);
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"data-warning",
			"true",
		);
		await info.attach("settings", {
			body: await page.screenshot({
				fullPage: true,
				path: info.outputPath("settings.png"),
			}),
			contentType: "image/png",
		});
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.getByRole("button", { name: "使用量20%" }).click();
		await expect.poll(offset).toBe(80);
		await page
			.getByRole("button", { name: "settings.ts を取り外す" })
			.click();
		await expect(
			page.getByRole("button", { name: "settings.ts を開く" }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "切断通知" }).click();
		for (const control of await page.getByRole("combobox").all()) {
			await expect(control).toBeDisabled();
		}
		await expect(
			page.getByRole("button", { name: "モデルと推論レベル" }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "コンテキストを追加" }),
		).toBeDisabled();
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		expect(errors).toEqual([]);
	});
}
