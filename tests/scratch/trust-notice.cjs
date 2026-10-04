// Storybook 起動後、`node tests/scratch/trust-notice.cjs before|after` で通知を撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 認証通知と未信頼通知を狭幅・明暗テーマで確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`trust-notice-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 360, height: 640 },
				reducedMotion: "reduce",
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-app--authentication&viewMode=story&globals=theme:${theme}`,
			);
			await expect(
				page.getByRole("region", { name: "認証", exact: true }),
			).toBeVisible();
			await page.screenshot({
				path: join(directory, `${theme}-auth.png`),
			});
			if (phase === "after") {
				await reviewTrust(page, directory, theme);
			}
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

/** 会話をスクロールしても通知が動かないこと、要求の送信、Host 応答による通知の非表示を順に検証する。 */
async function reviewTrust(page, directory, theme) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-header--untrusted-workspace&viewMode=story&globals=theme:${theme}`,
	);
	const notice = page.getByRole("region", { name: "ワークスペースの信頼" });
	await expect(notice).toBeVisible();
	const before = await notice.boundingBox();
	const conversation = page.getByRole("region", {
		name: "会話",
		exact: true,
	});
	await conversation.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const scrollTop = await conversation.evaluate(
		(element) => element.scrollTop,
	);
	expect(scrollTop).toBeGreaterThan(0);
	await conversation.evaluate((element) => {
		element.scrollTop = 0;
	});
	expect((await notice.boundingBox()).y).toBe(before.y);
	await page.screenshot({ path: join(directory, `${theme}-trust.png`) });
	await notice.getByRole("button", { name: "信頼する", exact: true }).click();
	expect(
		await page
			.locator("[data-story-chat]")
			.evaluate((element) =>
				element.storyBridge.sent.some(
					(message) => message.type === "workspace/manageTrust",
				),
			),
	).toBe(true);
	await expect(notice).toBeVisible();
	await page.locator("[data-story-chat]").evaluate((element) =>
		element.storyBridge.emit({
			type: "workspace/trustState",
			untrusted: false,
		}),
	);
	await expect(notice).toHaveCount(0);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
