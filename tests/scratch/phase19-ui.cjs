// `pnpm storybook` の起動後に `node tests/scratch/phase19-ui.cjs` で出力カードを確認する。幅を変える場合は数値を引数に渡す。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 表示幅を揃えて明暗テーマを切り替え、カードの開閉・取得待ち・表示範囲の移動を確認し、画像を保存する。 */
async function main() {
	const width = Number(process.argv[2] ?? 420);
	const directory = join(
		"dist/ui-review",
		`phase19-after-${width}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			await verifyTheme(browser, errors, width, directory, theme);
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

/** テーマごとにコピー用のブラウザー状態を用意し、出力カードの各操作を順に検証する。 */
async function verifyTheme(browser, errors, width, directory, theme) {
	const page = await browser.newPage({
		viewport: { width, height: 900 },
	});
	captureErrors(page, errors);
	await page.addInitScript(() => {
		globalThis.outputClipboard = { text: "", fail: false };
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: async (text) => {
					if (globalThis.outputClipboard.fail) {
						throw new Error("clipboard unavailable");
					}
					globalThis.outputClipboard.text = text;
				},
			},
		});
	});
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-tool-cards--large-output&viewMode=story&globals=theme:${theme}`,
	);
	const heading = await verifyPreview(page, directory, theme);
	const detail = await verifyDetailLoading(page);
	await verifyDetailNavigation(page, detail, directory, theme);
	await verifyDetailReopening(page, detail, heading);
	await page.close();
}

/** 折り畳まれたカードを開き、コマンド・出力プレビューとコピー結果を確認する。 */
async function verifyPreview(page, directory, theme) {
	const heading = page.locator(".tool-heading");
	await expect(heading).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator(".tool-card-collapse")).toBeHidden();
	await page.screenshot({
		path: join(directory, `${theme}-closed.png`),
	});
	await heading.click();
	await expect(page.locator(".tool-cwd")).toContainText("CWD");
	await expect(page.locator(".tool-command")).toHaveText(
		"Get-Content ./logs/very-long-directory-name/large-output-with-japanese-text.log",
	);
	await expect(page.locator(".tool-body")).toContainText("末尾エラー");
	const previewCopy = page.getByRole("button", {
		name: "出力をコピー",
		exact: true,
	});
	await previewCopy.hover();
	await expect(page.getByRole("tooltip")).toHaveText("出力をコピー");
	await page.screenshot({
		path: join(directory, `${theme}-copy-tooltip.png`),
		animations: "disabled",
	});
	await previewCopy.click();
	await expect
		.poll(() => page.evaluate(() => globalThis.outputClipboard.text))
		.toBe(
			"出力開始\nChecking types...\n\n… 18,420文字を省略 …\n\nFAIL: 末尾エラー",
		);
	await page.screenshot({
		path: join(directory, `${theme}-opened.png`),
		animations: "disabled",
	});
	return heading;
}

/** 詳細出力の取得中は操作を無効化し、応答後に表示とコピーができることを確認する。 */
async function verifyDetailLoading(page) {
	await page.getByRole("button", { name: "詳細出力", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "詳細出力" }),
	).toHaveAttribute("aria-busy", "true");
	const detail = page.getByRole("region", { name: "詳細出力" });
	await expect(
		detail.getByRole("button", { name: "出力をコピー" }),
	).toBeDisabled();
	await expect(
		detail.getByRole("button", { name: "前の範囲を表示" }),
	).toBeDisabled();
	await page.getByRole("button", { name: "出力応答を受信" }).click();
	await expect(page.getByRole("region", { name: "詳細出力" })).toContainText(
		"日本語と絵文字 🐈",
	);
	await detail.getByRole("button", { name: "出力をコピー" }).click();
	await expect
		.poll(() => page.evaluate(() => globalThis.outputClipboard.text))
		.toBe("先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(1000));
	return detail;
}

/** 詳細出力の前後の範囲への移動と、コピー失敗時の表示を確認する。 */
async function verifyDetailNavigation(page, detail, directory, theme) {
	const next = detail.getByRole("button", { name: "次の範囲を表示" });
	const background = await next.evaluate(
		(element) => globalThis.getComputedStyle(element).backgroundColor,
	);
	await next.hover();
	await expect(page.getByRole("tooltip")).toHaveText("次の範囲を表示");
	await expect
		.poll(() =>
			next.evaluate(
				(element) =>
					globalThis.getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(background);
	await page.screenshot({
		path: join(directory, `${theme}-detail.png`),
		fullPage: true,
		animations: "disabled",
	});
	await page.getByRole("button", { name: "次の範囲を表示" }).click();
	await page.getByRole("button", { name: "出力応答を受信" }).click();
	await expect(page.getByRole("region", { name: "詳細出力" })).toContainText(
		"次の詳細出力",
	);
	await expect(
		page.getByRole("region", { name: "詳細出力" }),
	).not.toContainText("先頭の詳細出力");
	await expect(
		detail.getByRole("button", { name: "次の範囲を表示" }),
	).toBeDisabled();
	await detail.getByRole("button", { name: "出力をコピー" }).click();
	await expect
		.poll(() => page.evaluate(() => globalThis.outputClipboard.text))
		.toBe("次の詳細出力\nFAIL: 末尾エラー");
	await page.evaluate(() => {
		globalThis.outputClipboard.fail = true;
	});
	await detail.getByRole("button", { name: "出力をコピー" }).click();
	await expect(
		detail.getByRole("button", { name: "出力をコピー" }),
	).toHaveAttribute("data-copy-result", "error");
	await page.evaluate(() => {
		globalThis.outputClipboard.fail = false;
	});
	const previous = detail.getByRole("button", {
		name: "前の範囲を表示",
		exact: true,
	});
	await previous.hover();
	await expect(page.getByRole("tooltip")).toHaveText("前の範囲を表示");
	await page.screenshot({
		path: join(directory, `${theme}-previous-tooltip.png`),
		animations: "disabled",
	});
	await previous.click();
	await page.getByRole("button", { name: "出力応答を受信" }).click();
	await expect(page.getByRole("region", { name: "詳細出力" })).toContainText(
		"先頭の詳細出力",
	);
}

/** 詳細出力を開き直して取得し、完了通知後も表示が維持されることを確認する。 */
async function verifyDetailReopening(page, detail, heading) {
	const disclosure = page.getByRole("button", {
		name: "詳細出力",
		exact: true,
	});
	await disclosure.click();
	await expect(detail).toHaveCount(0);
	await expect(disclosure).toHaveAttribute("aria-expanded", "false");
	await disclosure.click();
	await expect(detail).toHaveAttribute("aria-busy", "true");
	await page.getByRole("button", { name: "出力応答を受信" }).click();
	await expect(detail).toContainText("先頭の詳細出力");
	await page.getByRole("button", { name: "完了通知を受信" }).click();
	await expect(heading).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("region", { name: "詳細出力" })).toContainText(
		"先頭の詳細出力",
	);
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
