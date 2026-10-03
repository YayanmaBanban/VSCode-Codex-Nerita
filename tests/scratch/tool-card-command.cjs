// Storybook 起動後、`node tests/scratch/tool-card-command.cjs` で見出しと完了時の開閉を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマ・狭い幅でコマンド本文、ツールチップと完了後の開閉状態を確認する。 */
async function main() {
	const directory = join("dist/ui-review", `tool-card-command-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [420, 320]) {
				const page = await browser.newPage({
					viewport: { width, height: 900 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") {
						errors.push(message.text());
					}
				});
				await verifyCommandCards(page, theme, width, directory);
				await verifyOtherCards(page, theme);
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

/** Host の正規化済みタイトルと元の実行コマンドを、それぞれの表示で確認する。 */
async function verifyCommandCards(page, theme, width, directory) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-tool-cards--command-titles&viewMode=story&globals=theme:${theme}`,
	);
	const cards = page.locator(".tool-card");
	const codex = cards.nth(0);
	const pi = cards.nth(1);
	const closed = cards.nth(2).locator(".tool-heading");
	const title =
		"Get-Content ./src/chat/tools/ToolCard.tsx; rg SettingsTooltip ./src/chat";
	await expect(codex.locator(".tool-title")).toHaveText(title);
	await expect(codex.locator(".tool-title")).not.toHaveAttribute("title");
	await codex.locator(".tool-heading").hover();
	await expect(page.getByRole("tooltip")).toHaveText(title);
	await page.screenshot({
		path: join(directory, `${theme}-${width}-tooltip.png`),
		animations: "disabled",
	});
	await codex.locator(".tool-heading").focus();
	await codex.locator(".tool-heading").press("Enter");
	await expect(codex.locator(".tool-heading")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await expect(codex.locator(".tool-command")).toContainText(
		'"./WindowsPowerShell/powershell.exe" -NoProfile -Command',
	);
	await pi.locator(".tool-heading").click();
	await expect(pi.locator(".tool-command")).toHaveText(
		'Get-Location\nWrite-Output "日本語の出力を確認します"',
	);
	await page.getByRole("button", { name: "完了通知を受信" }).click();
	await expect(codex.locator(".tool-heading")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await expect(pi.locator(".tool-heading")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await expect(closed).toHaveAttribute("aria-expanded", "false");
	await expect(
		codex.getByRole("img", { name: "完了", exact: true }),
	).toBeVisible();
	await expect(codex.locator(".tool-body")).toContainText("Codex の実行結果");
	await expect(pi.locator(".tool-body")).toContainText("Pi の実行結果");
	await pi.locator(".tool-heading").hover();
	await expect(page.getByRole("tooltip")).toHaveText(
		'Get-Location\nWrite-Output "日本語の出力を確認します"',
	);
	await page.screenshot({
		path: join(directory, `${theme}-${width}-completed-open.png`),
		animations: "disabled",
	});
	await codex.locator(".tool-heading").press("Enter");
	await expect(codex.locator(".tool-heading")).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await expect(codex.locator(".tool-card-collapse")).toBeHidden();
}

/** タスクの完了状態を優先する実行カードと、一覧型カードでも手動展開を維持する。 */
async function verifyOtherCards(page, theme) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-tool-cards--background&viewMode=story&globals=theme:${theme}`,
	);
	const heading = page.locator(".tool-heading");
	await heading.click();
	await page.getByRole("button", { name: "完了通知を受信" }).click();
	await expect(heading).toHaveAttribute("aria-expanded", "true");
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-activity-tools--all&viewMode=story&globals=theme:${theme}`,
	);
	const think = page
		.locator('.tool-card[data-kind="think"]')
		.first()
		.locator(".tool-heading");
	await think.click();
	await page.getByRole("button", { name: "完了通知を受信" }).click();
	await expect(think).toHaveAttribute("aria-expanded", "true");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
