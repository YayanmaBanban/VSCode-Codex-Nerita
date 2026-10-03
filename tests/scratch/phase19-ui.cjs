// pnpm storybook の起動後に node tests/scratch/phase19-ui.cjs で出力カードの表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 幅とテーマを揃え、閉じた状態・展開・取得待ち・範囲移動を撮影する。 */
async function main() {
	const directory = join("dist/ui-review", `phase19-after-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 900 },
			});
			captureErrors(page, errors);
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-tool-cards--large-output&viewMode=story&globals=theme:${theme}`,
			);
			const heading = page.locator(".tool-heading");
			await expect(heading).toHaveAttribute("aria-expanded", "false");
			await expect(page.locator(".tool-cwd")).toHaveCount(0);
			await page.screenshot({
				path: join(directory, `${theme}-closed.png`),
			});
			await heading.click();
			await expect(page.locator(".tool-cwd")).toContainText("CWD");
			await expect(page.locator(".tool-command")).toHaveText(
				"Get-Content ./logs/very-long-directory-name/large-output-with-japanese-text.log",
			);
			await expect(page.locator(".tool-body")).toContainText(
				"末尾エラー",
			);
			await page.screenshot({
				path: join(directory, `${theme}-opened.png`),
			});
			await page
				.getByRole("button", { name: "出力を表示", exact: true })
				.click();
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).toHaveAttribute("aria-busy", "true");
			await page.getByRole("button", { name: "出力応答を受信" }).click();
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).toContainText("日本語と絵文字 🐈");
			await page.screenshot({
				path: join(directory, `${theme}-detail.png`),
				fullPage: true,
			});
			await page.getByRole("button", { name: "次の範囲を表示" }).click();
			await page.getByRole("button", { name: "出力応答を受信" }).click();
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).toContainText("次の詳細出力");
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).not.toContainText("先頭の詳細出力");
			await page
				.getByRole("button", { name: "前へ", exact: true })
				.click();
			await page.getByRole("button", { name: "出力応答を受信" }).click();
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).toContainText("先頭の詳細出力");
			await page.getByRole("button", { name: "完了通知を受信" }).click();
			await expect(heading).toHaveAttribute("aria-expanded", "false");
			await expect(
				page.getByRole("region", { name: "詳細出力" }),
			).toHaveCount(0);
			await page.close();
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

/** 表示の成功とは別に、ブラウザー内の実行エラーを収集する。 */
function captureErrors(page, errors) {
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
