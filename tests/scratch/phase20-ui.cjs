// Storybook 起動後に node tests/scratch/phase20-ui.cjs <port> で Sandbox と承認画面を撮影する。
/* global document, window */
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 製品コンポーネントを明暗・狭幅で確認し、コンソールエラーも記録する。 */
async function main() {
	const directory = join("dist/ui-review", `phase20-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [390, 960]) {
				const page = await browser.newPage({
					viewport: { width, height: 1000 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") {
						errors.push(message.text());
					}
				});
				await review(page, theme, width, directory);
				await page.close();
			}
		}
		await writeFile(
			join(directory, "errors.json"),
			JSON.stringify(errors, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

/** 新しい管理画面と4択承認の表示を検証し、取消保存失敗でも承認が残ることを確認する。 */
async function review(page, theme, width, directory) {
	const url = (story) =>
		`http://localhost:${process.argv[2] ?? 6006}/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`;
	await page.goto(url("chat-permission--long-command"));
	await expect(page.getByText("Pi: powershell の実行承認")).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-${width}-existing-permission.png`),
		fullPage: true,
	});
	await page.goto(url("chat-permission--native-pnpm"));
	for (const name of [
		"今回だけ",
		"セッション中",
		"このワークスペース",
		"キャンセル",
	]) {
		await expect(
			page.getByRole("button", { name, exact: true }),
		).toBeVisible();
	}
	await page.screenshot({
		path: join(directory, `${theme}-${width}-host-permission.png`),
		fullPage: true,
	});
	await page.goto(url("pi-sandbox--default"));
	await expect(
		page.getByRole("heading", { name: "Sandbox", exact: true }),
	).toBeVisible();
	await expect(page.locator("option[value=docker]")).toHaveJSProperty(
		"disabled",
		true,
	);
	await page.getByRole("combobox", { name: "実行環境" }).focus();
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("combobox", { name: "実行環境" })).toHaveValue(
		"mxc",
	);
	await page.getByRole("button", { name: "承認を取り消す" }).click();
	await expect(page.getByRole("alert")).toContainText("保存に失敗");
	await expect(page.getByText("pnpm · read-only-ish")).toBeVisible();
	await reviewResources(page);
	await page.screenshot({
		path: join(directory, `${theme}-${width}-settings.png`),
		fullPage: true,
	});
	await page.goto(url("pi-sandbox--unavailable"));
	await expect(
		page.getByText(
			"MXC 起動検査に失敗しました。選択中の実行環境を確認してください。",
		),
	).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-${width}-unavailable.png`),
		fullPage: true,
	});
	await reviewLargeOutput(page, url, theme, width, directory);
}

/** 大量出力はプレビューから明示的に範囲取得し、次の範囲へ置き換えて表示する。 */
async function reviewLargeOutput(page, url, theme, width, directory) {
	await page.goto(url("chat-tool-cards--large-output"));
	await page
		.getByRole("button", { name: /^Get-Content/, expanded: false })
		.click();
	await expect(page.getByText("先頭の詳細出力", { exact: true })).toHaveCount(
		0,
	);
	await page.getByRole("button", { name: "詳細出力", exact: true }).click();
	const detail = page.getByRole("region", { name: "詳細出力", exact: true });
	await expect(
		detail.getByRole("button", { name: "次の範囲を表示" }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "出力応答を受信", exact: true })
		.click();
	await expect(detail).toContainText("先頭の詳細出力");
	await page.screenshot({
		path: join(directory, `${theme}-${width}-large-output.png`),
		fullPage: true,
	});
	await detail.getByRole("button", { name: "次の範囲を表示" }).click();
	await page
		.getByRole("button", { name: "出力応答を受信", exact: true })
		.click();
	await expect(detail).toContainText("次の詳細出力");
	await expect(detail).not.toContainText("先頭の詳細出力");
	await expect(
		detail.getByRole("button", { name: "次の範囲を表示" }),
	).toBeDisabled();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
}

/** 許可・キャッシュ切替・取消しの失敗で、Host の状態を表示から消さない。 */
async function reviewResources(page) {
	for (const name of [
		"今回だけ許可して再実行",
		"セッション中許可して再実行",
		"このワークスペースで許可して再実行",
		"Sandbox キャッシュを使用して再実行",
	]) {
		const button = page.getByRole("button", { name, exact: true });
		await expect(button).toBeVisible();
		await button.click();
		await expect(page.getByRole("alert")).toContainText("保存に失敗");
		await expect(button).toBeEnabled();
	}
	await page
		.getByRole("button", { name: "リソース権限を取り消す", exact: true })
		.click();
	await expect(
		page.getByText("tools/node/helper.exe", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "キャッシュ切替を取り消す", exact: true })
		.click();
	await expect(
		page.getByText("pnpm · Sandbox キャッシュ", { exact: true }),
	).toBeVisible();
	const diagnostic = page
		.getByText("Object Manager diagnostic", { exact: true })
		.locator("..");
	await expect(diagnostic.getByRole("button")).toHaveCount(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
