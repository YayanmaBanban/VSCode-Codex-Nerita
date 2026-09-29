// Host の色変数がない環境の配色と、body へのテーマ注入・切替を確認する。
import { test, expect } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
	for (const story of ["pi-guardrails--editor", "pi-workflow--editor"]) {
		test(`テーマ変数なしの独立画面: ${story} ${scheme}`, async ({
			page,
		}, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.emulateMedia({
				colorScheme: scheme,
				reducedMotion: "reduce",
			});
			await page.goto(
				`/iframe.html?id=${story}&viewMode=story&globals=theme:default`,
			);
			await expect(page.locator("#storybook-root")).not.toBeEmpty();
			await expect(page.locator("html")).not.toHaveAttribute(
				"data-storybook-theme",
			);
			await expect(page.locator("body")).toHaveCSS(
				"background-color",
				scheme === "light" ? "rgb(247, 249, 249)" : "rgb(22, 25, 29)",
			);
			await info.attach(`fallback-${story}-${scheme}`, {
				body: await page.screenshot({
					path: info.outputPath(`fallback-${scheme}.png`),
				}),
				contentType: "image/png",
			});
			expect(errors).toEqual([]);
		});
	}
	test(`テーマ変数なしのチャットとテーマ切替: ${scheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({
			colorScheme: scheme,
			reducedMotion: "reduce",
		});
		await page.goto(
			"/iframe.html?id=chat-app--completed&viewMode=story&globals=theme:default",
		);
		await expect(
			page.getByRole("button", { name: "回答をコピー" }).first(),
		).toBeVisible();
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-storybook-theme",
		);
		const actions = page.locator(".message-actions > div").last();
		await expect(actions.getByRole("button").first()).toHaveCSS(
			"color",
			scheme === "light" ? "rgb(36, 46, 54)" : "rgb(223, 228, 233)",
		);
		await expect(actions).toHaveCSS(
			"background-color",
			scheme === "light" ? "rgb(234, 240, 241)" : "rgb(32, 37, 43)",
		);
		await expect(actions).toHaveCSS(
			"border-top-color",
			scheme === "light" ? "rgb(203, 211, 218)" : "rgb(42, 43, 44)",
		);
		expect(
			await page
				.locator("body")
				.evaluate((body) =>
					getComputedStyle(body).getPropertyValue(
						"--vscode-widget-border",
					),
				),
		).toBe("");
		await info.attach(`fallback-${scheme}`, {
			body: await page.screenshot({
				path: info.outputPath(`fallback-${scheme}.png`),
			}),
			contentType: "image/png",
		});

		// VS Code と同じ body 上の変数を優先し、実行中の変更にも追従する。
		await page.locator("body").evaluate((body) => {
			body.style.setProperty("--vscode-widget-border", "rgb(17, 34, 51)");
			body.style.setProperty(
				"--vscode-editor-background",
				"rgb(51, 68, 85)",
			);
		});
		await expect(actions).toHaveCSS("border-top-color", "rgb(17, 34, 51)");
		await expect(actions).toHaveCSS("background-color", "rgb(51, 68, 85)");
		await page
			.locator("body")
			.evaluate((body) =>
				body.style.setProperty(
					"--vscode-widget-border",
					"rgb(85, 102, 119)",
				),
			);
		await expect(actions).toHaveCSS(
			"border-top-color",
			"rgb(85, 102, 119)",
		);
		expect(errors).toEqual([]);
	});
}
