// 新規 Workflow エディタの明暗・狭幅表示と、編集・検証・停止を確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	for (const width of [390, 1280]) {
		test(`workflow ${theme} ${width}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width, height: 950 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(
				"/iframe.html?id=pi-workflow--editor&viewMode=story",
			);
			await expect(
				page.getByRole("heading", { name: "Pi Workflow" }),
			).toBeVisible();
			await expect(page.locator(".react-flow__node")).toHaveCount(4);
			await page.screenshot({ path: info.outputPath("graph.png") });
			await page
				.getByRole("button", { name: "＋ ステップを追加" })
				.click();
			await expect(page.getByLabel("ステップ ID")).toHaveValue("step1");
			await page.getByLabel("ステップ ID").fill("extra");
			await page
				.getByRole("button", { name: "変更", exact: true })
				.click();
			await page
				.getByRole("textbox", { name: "タスク", exact: true })
				.fill("追加した確認作業");
			await page.getByLabel("コンテキスト").selectOption("fork");
			await expect(page.getByLabel("会話の継承元")).toHaveValue(
				"implement",
			);
			await page.getByRole("switch", { name: "TOML 編集" }).click();
			await expect(page.getByLabel("Workflow TOML")).toContainText(
				'id = "extra"',
			);
			await page.screenshot({ path: info.outputPath("toml.png") });
			await page
				.getByRole("button", { name: "検証", exact: true })
				.click();
			await expect(
				page.getByText("TOML と依存関係を検証しました。", {
					exact: false,
				}),
			).toBeVisible();
			await page
				.getByRole("button", { name: "生成スクリプトを表示" })
				.click();
			await expect(page.locator(".workflow-editor pre")).toContainText(
				"neritaFork",
			);
			await page
				.getByRole("button", { name: "保存", exact: true })
				.click();
			await page.getByRole("switch", { name: "TOML 編集" }).click();
			await page
				.getByRole("button", { name: "実行", exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: "停止", exact: true }),
			).toBeEnabled();
			await expect(
				page.getByRole("textbox", { name: "タスク", exact: true }),
			).toBeDisabled();
			await page.screenshot({ path: info.outputPath("running.png") });
			await page
				.getByRole("button", { name: "停止", exact: true })
				.click();
			await expect(page.getByText("実行を停止しました。")).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			expect(errors).toEqual([]);
		});
	}
}

test("workflow invalid TOML recovery", async ({ page }, info) => {
	await page.goto("/iframe.html?id=pi-workflow--invalid&viewMode=story");
	await expect(page.getByLabel("Workflow TOML")).toHaveValue("version = [");
	await page.getByRole("button", { name: "検証", exact: true }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await page.screenshot({ path: info.outputPath("invalid.png") });
	await page
		.getByLabel("Workflow TOML")
		.fill(
			'version = 1\nname = "recovered"\noutputs = ["a"]\n[[steps]]\nid = "a"\nagent = "worker"\ntask = "task"\n',
		);
	await expect(page.locator(".react-flow__node")).toHaveCount(1);
	await page.getByRole("button", { name: "検証", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("workflow canvas connections and deletion", async ({ page }, info) => {
	await page.setViewportSize({ width: 1280, height: 950 });
	await page.goto("/iframe.html?id=pi-workflow--editor&viewMode=story");
	const source = page.locator('[data-nodeid="tests"].source');
	const target = page.locator('[data-nodeid="review"].target');
	await source.dragTo(target);
	await expect(
		page.locator('.react-flow__edge[data-id="tests:review"]'),
	).toBeVisible();
	await page
		.locator('[data-nodeid="review"].source')
		.dragTo(page.locator('[data-nodeid="implement"].target'));
	await expect(page.getByRole("alert")).toContainText("循環");
	await page.getByRole("switch", { name: "TOML 編集" }).click();
	await expect(
		page.getByRole("textbox", { name: "Workflow TOML" }),
	).toContainText('"tests"');
	await page.getByRole("switch", { name: "TOML 編集" }).click();
	const edge = page.locator('.react-flow__edge[data-id="tests:review"]');
	await edge.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Backspace");
	await expect(
		page.locator('.react-flow__edge[data-id="tests:review"]'),
	).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("connections.png") });
});
