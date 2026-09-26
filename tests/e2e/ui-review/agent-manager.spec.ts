// 実フォームで Pi・Codex・ハンドオフの保存操作と狭幅表示を確認する。
import { test, expect } from "@playwright/test";

test("handoff keeps all models visible after selection and offers Ultra for every supported model", async ({
	page,
}, info) => {
	await page.goto("/iframe.html?id=agent-manager--settings&viewMode=story");
	await page.getByRole("button", { name: "ハンドオフ", exact: true }).click();
	for (const backend of ["pi", "codex"] as const) {
		await page.getByLabel(`${backend} Strategy`).selectOption("fixed");
		const model = page.getByLabel(`${backend} Model`);
		const effort = page.getByLabel(
			backend === "pi" ? "Thinking" : "Reasoning effort",
			{ exact: true },
		);
		const prefix = backend === "pi" ? "openai-codex/" : "";
		await model.selectOption(`${prefix}gpt-6-luna`);
		await expect(
			model.locator(`option[value="${prefix}gpt-6-astra"]`),
		).toHaveCount(1);
		await expect(
			model.locator(`option[value="${prefix}gpt-5.6-sol"]`),
		).toHaveCount(1);
		await expect(effort.locator('option[value="ultra"]')).toHaveCount(0);
		for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-5.6-sol"]) {
			await model.selectOption(`${prefix}${id}`);
			await effort.selectOption("ultra");
			await expect(effort).toHaveValue("ultra");
		}
	}
	await page.getByRole("button", { name: "ハンドオフ設定を保存" }).click();
	await expect(page.getByRole("status")).toHaveText("保存しました。");
	await info.attach("handoff-ultra", {
		body: await page.screenshot({
			path: info.outputPath("handoff-ultra.png"),
			fullPage: true,
		}),
		contentType: "image/png",
	});
});

for (const theme of ["dark", "light"] as const) {
	for (const width of [320, 1100]) {
		test(`agent manager ${theme} ${width}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width, height: 1000 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(
				"/iframe.html?id=agent-manager--settings&viewMode=story",
			);
			await expect(
				page.getByRole("heading", { name: "Workspace defaults" }),
			).toBeVisible();
			await page.getByLabel("セッション内の起動上限").fill("5");
			await page
				.getByLabel("モデル", { exact: true })
				.selectOption("openai-codex/gpt-6-sol");
			await page
				.getByLabel("Default thinking", { exact: true })
				.selectOption("low");
			await expect(
				page
					.getByLabel("Default thinking", { exact: true })
					.locator('option[value="off"]'),
			).toHaveCount(0);
			await expect(
				page
					.getByLabel("Default thinking", { exact: true })
					.locator('option[value="minimal"]'),
			).toHaveCount(0);
			await page.getByRole("button", { name: "既定値を保存" }).click();
			await expect(page.getByRole("status")).toHaveText("保存しました。");
			await page.getByLabel("編集対象").selectOption("pi:reviewer");
			await page.getByLabel("有効／無効").selectOption("disabled");
			await page
				.getByLabel("モデル", { exact: true })
				.selectOption("openai-codex/gpt-6-sol");
			await page
				.getByLabel("Thinking", { exact: true })
				.selectOption("low");
			await expect(
				page
					.getByLabel("Thinking", { exact: true })
					.locator('option[value="minimal"]'),
			).toHaveCount(0);
			await page
				.getByRole("button", { name: "Agent 設定を保存" })
				.click();
			await expect(page.getByLabel("有効／無効")).toHaveValue("disabled");
			await info.attach("pi-agent", {
				body: await page.screenshot({
					path: info.outputPath("pi-agent.png"),
					fullPage: true,
				}),
				contentType: "image/png",
			});
			await page
				.getByRole("button", { name: "Codex", exact: true })
				.click();
			await page.getByLabel("Reasoning effort").selectOption("medium");
			await page
				.getByLabel("モデル", { exact: true })
				.selectOption("limited-model");
			await expect(
				page.getByRole("button", { name: "Agent 設定を保存" }),
			).toBeDisabled();
			await expect(page.getByRole("alert")).toContainText("非対応");
			await expect(
				page
					.getByLabel("Reasoning effort")
					.locator('option[value="high"]'),
			).toHaveCount(0);
			await page.getByLabel("Reasoning effort").selectOption("low");
			await expect(
				page.getByRole("button", { name: "Agent 設定を保存" }),
			).toBeEnabled();
			await page
				.getByLabel("モデル", { exact: true })
				.selectOption("gpt-6-sol");
			await page.getByLabel("Reasoning effort").selectOption("medium");
			await page
				.getByRole("button", { name: "Agent 設定を保存" })
				.click();
			await expect(page.getByLabel("Reasoning effort")).toHaveValue(
				"medium",
			);
			await info.attach("codex-agent", {
				body: await page.screenshot({
					path: info.outputPath("codex-agent.png"),
					fullPage: true,
				}),
				contentType: "image/png",
			});
			await page
				.getByRole("button", { name: "ハンドオフ", exact: true })
				.click();
			await page.getByLabel("pi Strategy").selectOption("fixed");
			await page
				.getByLabel("pi Model")
				.selectOption("openai-codex/gpt-6-sol");
			await page.getByLabel("codex Strategy").selectOption("fixed");
			await page.getByLabel("codex Model").selectOption("gpt-6-sol");
			await page
				.getByLabel("Thinking", { exact: true })
				.selectOption("high");
			await page.getByLabel("Reasoning effort").selectOption("high");
			await page
				.getByRole("button", { name: "ハンドオフ設定を保存" })
				.click();
			await expect(page.getByLabel("pi Model")).toHaveValue(
				"openai-codex/gpt-6-sol",
			);
			await page.getByText("出力 JSON", { exact: true }).click();
			await expect(page.locator("main pre")).toContainText(
				'"strategy": "fixed"',
			);
			await info.attach("handoff-fixed", {
				body: await page.screenshot({
					path: info.outputPath("handoff-fixed.png"),
					fullPage: true,
				}),
				contentType: "image/png",
			});
			await page.getByLabel("pi Strategy").selectOption("current");
			await expect(page.getByLabel("pi Model")).toHaveCount(0);
			await expect(
				page
					.getByLabel("Thinking", { exact: true })
					.locator('option[value="off"]'),
			).toHaveCount(0);
			await expect(page.locator("main pre")).not.toContainText(
				"openai-codex/gpt-6-sol",
			);
			await page.getByLabel("codex Strategy").focus();
			await page.keyboard.press("Tab");
			await expect(page.getByLabel("codex Model")).toBeFocused();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			expect(errors).toEqual([]);
		});
	}
}

test("agent manager retains inputs on conflict and repairs malformed handoff explicitly", async ({
	page,
}, info) => {
	await page.goto("/iframe.html?id=agent-manager--conflict&viewMode=story");
	await page.getByLabel("セッション内の起動上限").fill("17");
	await page.getByRole("button", { name: "既定値を保存" }).click();
	await expect(page.getByRole("alert")).toContainText("再読み込み");
	await expect(page.getByLabel("セッション内の起動上限")).toHaveValue("17");
	await page.goto("/iframe.html?id=agent-manager--invalid&viewMode=story");
	await page.getByRole("button", { name: "ハンドオフ", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "ハンドオフ設定を保存" }),
	).toBeDisabled();
	await info.attach("invalid", {
		body: await page.screenshot({ path: info.outputPath("invalid.png") }),
		contentType: "image/png",
	});
	await page
		.getByRole("button", { name: "初期値から設定を作り直す" })
		.click();
	await page.getByRole("button", { name: "ハンドオフ設定を保存" }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("agent manager handles empty definitions", async ({ page }, info) => {
	await page.goto("/iframe.html?id=agent-manager--empty&viewMode=story");
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await expect(page.getByLabel("編集対象")).toHaveValue("");
	await expect(
		page.getByText(".codex/agents/*.toml にある Agent 定義を表示します。"),
	).toBeVisible();
	await info.attach("empty", {
		body: await page.screenshot({ path: info.outputPath("empty.png") }),
		contentType: "image/png",
	});
});
