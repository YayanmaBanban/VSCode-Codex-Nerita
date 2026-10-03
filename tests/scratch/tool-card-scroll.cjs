// Storybook 起動後、`node tests/scratch/tool-card-scroll.cjs after` で変更後のスクロールを確認する。変更前は引数を `before` にする。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 末尾からカードを展開し、ヘッダーの位置と手動スクロールを明暗テーマで確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`tool-scroll-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 600 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-tool-cards--scroll-expansion&viewMode=story&globals=theme:${theme}`,
			);
			const headings = page.locator(".tool-heading");
			await expect(headings).toHaveCount(6);
			await page.screenshot({
				path: join(directory, `${theme}-before.png`),
			});
			for (const index of [0, 1, 5]) {
				const heading = headings.nth(index);
				await waitForCards(page);
				await heading.scrollIntoViewIfNeeded();
				const position = await heading.boundingBox();
				await heading.click();
				await expect(heading).toHaveAttribute("aria-expanded", "true");
				await expect
					.poll(() =>
						heading.evaluate((element) => {
							const card = element.closest(".tool-card");
							const collapse = card.querySelector(
								".tool-card-collapse, .combo-list-collapse",
							);
							return collapse.getAnimations().length;
						}),
					)
					.toBe(0);
				await verifyHeader(heading, phase, position.y);
				await page.screenshot({
					path: join(directory, `${theme}-opened-${index}.png`),
				});
				await page.mouse.click(
					position.x + position.width / 2,
					position.y + position.height / 2,
				);
				await expect(heading).toHaveAttribute("aria-expanded", "false");
			}
			await reviewInputMethods(page, phase);
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

/** 次の見出し位置を測る前に、カードの開閉アニメーションの完了を待つ。 */
async function waitForCards(page) {
	await expect
		.poll(() =>
			page.locator(".tool-card").evaluateAll((cards) => {
				let count = 0;
				for (const card of cards) {
					count += card.getAnimations({ subtree: true }).length;
				}
				return count;
			}),
		)
		.toBe(0);
}

/** キーボードによる展開、アニメーションを減らす設定、展開後の手動スクロールを確認する。 */
async function reviewInputMethods(page, phase) {
	if (phase !== "after") {
		return;
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.reload();
	const heading = page.locator(".tool-heading").first();
	await heading.focus();
	const position = await heading.boundingBox();
	await heading.press("Enter");
	await expect(heading).toHaveAttribute("aria-expanded", "true");
	await verifyHeader(heading, phase, position.y);
	const container = page.locator("div.overflow-y-auto").first();
	const originalTop = await container.evaluate(
		(element) => element.scrollTop,
	);
	await page.mouse.move(410, 200);
	await page.mouse.wheel(0, 100);
	await expect
		.poll(() => container.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(originalTop + 20);
}

/** 変更後は開いたヘッダーが開く前と同じ画面上の位置にあることを確認する。 */
async function verifyHeader(heading, phase, originalY) {
	if (phase !== "after") {
		return;
	}
	await expect
		.poll(() =>
			heading.evaluate(
				(element, originalY) =>
					Math.abs(element.getBoundingClientRect().top - originalY),
				originalY,
			),
		)
		.toBeLessThan(3);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
