// Storybook 起動後、Codex と Pi の未信頼 Worktree 表示を明暗・狭幅で撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const storybookUrl = process.argv[2] ?? "http://localhost:6007";

async function main() {
	const directory = join(
		"dist/ui-review",
		`dlc-workspace-trust-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const response = await fetch(`${storybookUrl}/index.json`);
	const index = await response.json();
	const stories = Object.values(index.entries).filter((entry) =>
		entry.id.endsWith("-untrusted-worktree"),
	);
	const browser = await chromium.launch();
	const errors = [];
	const conditions = ["dark2026", "light"].flatMap((theme) =>
		[320, 720].map((width) => ({ theme, width })),
	);
	try {
		for (const condition of conditions) {
			for (const backend of ["codex", "pi"]) {
				const storyId = stories.find((entry) =>
					entry.id.endsWith(`${backend}-untrusted-worktree`),
				)?.id;
				expect(storyId).toBeTruthy();
				await capture(
					browser,
					{ directory, ...condition, backend, storyId },
					errors,
				);
			}
		}
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

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

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
