// 検証用 Storybook の起動後、未信頼状態で起動した際の操作とスクロール中の通知位置を、明暗テーマと狭い表示幅で確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 製品のワークスペース画面を表示し、通知がコンテンツと一緒にスクロールしないことを確認する。 */
async function main() {
	const base = process.argv[2] ?? "http://localhost:6007";
	const directory = join("dist/ui-review", `dlc-startup-trust-${Date.now()}`);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 960]) {
				const page = await browser.newPage({
					viewport: { width, height: 720 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				await page.goto(
					`${base}/iframe.html?id=chat-dlc-workspace-states--untrusted-startup&viewMode=story&globals=theme:${theme}`,
				);
				await page.waitForFunction(() =>
					globalThis.__STORYBOOK_PREVIEW__?.storyRenders?.some(
						(render) =>
							["finished", "completed"].includes(render.phase),
					),
				);
				const alert = page.getByRole("alert");
				await expect(alert).toBeVisible();
				await expect(
					page.getByRole("button", {
						name: "ワークスペースを信頼する",
						exact: true,
					}),
				).toBeEnabled();
				await expect(
					page.getByRole("combobox", { name: "DLC のバックエンド" }),
				).toBeDisabled();
				const before = await alert.boundingBox();
				await page
					.getByRole("region", { name: "実行環境" })
					.evaluate((element) => {
						element.parentElement.scrollTop = 1000;
					});
				const after = await alert.boundingBox();
				expect(after.y).toBe(before.y);
				await page.screenshot({
					path: join(directory, `${theme}-${width}.png`),
					fullPage: true,
				});
				expect(
					await page.evaluate(
						() =>
							globalThis.document.documentElement.scrollWidth >
							globalThis.innerWidth,
					),
				).toBe(false);
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

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
