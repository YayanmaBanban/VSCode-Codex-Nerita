// Storybook 起動後、Codex と Pi の未信頼 Worktree 表示を明暗・狭幅で撮影する。
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const storybookUrl = process.env.SCRATCH_PHASE ?? "http://localhost:6006";

/** 実コンポーネントの Host 応答を待ち、バックエンド別の信頼表示と操作を照合する。 */
async function capture(
	browser,
	{ directory, theme, width, backend, storyId },
	errors,
) {
	const page = await browser.newPage({ viewport: { width, height: 900 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`${storybookUrl}/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme}`,
		);
		const worktree = page.getByRole("combobox", {
			name: "DLC の Worktree",
		});
		await expect(worktree).toBeVisible({ timeout: 30000 });
		await expect(worktree).toHaveText("work-new（未信頼）");
		const trust = page.getByRole("button", {
			name: "ワークスペースを信頼する",
			exact: true,
		});
		await expect(trust).toHaveCount(1);
		await worktree.click();
		await expect(
			page.getByRole("button", {
				name: "work-new（未信頼）",
				exact: true,
			}),
		).toHaveCount(1);
		await page.keyboard.press("Escape");
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${backend}.png`),
			fullPage: true,
		});
		if (backend === "pi") {
			await trust.hover();
			await expect(
				page.getByRole("tooltip", { name: "ワークスペースを信頼する" }),
			).toBeVisible();
			await page.screenshot({
				path: join(
					directory,
					`${theme}-${width}-${backend}-tooltip.png`,
				),
				fullPage: true,
			});
		}
	} catch (error) {
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${backend}-failed.png`),
			fullPage: true,
		});
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
		throw error;
	} finally {
		await page.close();
	}
}

const storyIds = [
	"chat-dlc-workspace--codex-untrusted-worktree",
	"chat-dlc-workspace--pi-untrusted-worktree",
];
for (const id of storyIds) {
	for (const theme of ["dark2026", "light"]) {
		for (const width of [320, 720]) {
			test(`dlc-workspace-trust: ${id} ${theme} ${width} @visual @layout`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				const directory = testInfo.outputPath("review");
				await mkdir(directory, { recursive: true });
				const errors = [];
				const backend = id.includes("codex-untrusted-worktree")
					? "codex"
					: "pi";
				expect(id).toBeTruthy();
				await capture(
					browser,
					{ directory, theme, width, backend, storyId: id },
					errors,
				);
				expect(errors).toEqual([]);
			});
		}
	}
}
