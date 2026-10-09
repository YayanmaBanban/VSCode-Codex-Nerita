// Storybook の大量履歴で、画面外検索・強調・幅変更・スクロールを操作して撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗と狭幅で表示周辺だけが描画されることを確認する。 */
async function run() {
	const directory = join(
		"dist/ui-review",
		`chat-virtualization-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [],
		results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 360, height: 740 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			try {
				results.push(await review(page, directory, theme));
				await reviewUpdates(page, directory, theme);
			} finally {
				await page.screenshot({
					path: join(directory, `${theme}-final.png`),
				});
				await page.close();
			}
		}
		expect(errors).toEqual([]);
	} finally {
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ errors, results }, null, 2),
		);
		await browser.close();
		console.log(directory);
	}
}

/** Host への保存と復元通知を経由し、幅変更と追加応答後も読む位置を保つ。 */
async function reviewUpdates(page, directory, theme) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-virtualization--updates&viewMode=story&globals=theme:${theme}`,
	);
	const conversation = page.getByRole("region", {
		name: "会話",
		exact: true,
	});
	await expect(
		page.getByText("末尾の検索対象", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Control+f");
	const input = page.getByRole("textbox", { name: "会話を検索" });
	await input.fill("履歴 80:");
	await expect(page.getByLabel("検索結果", { exact: true })).toHaveText(
		"1/1",
	);
	await expect(
		conversation.locator('[data-entry-key="message:virtual-message-80"]'),
	).toBeVisible();
	await input.press("Escape");
	const before = await readAnchor(conversation);
	await page.getByRole("button", { name: "エディタグループへ移動" }).click();
	await page.getByRole("button", { name: "メッセージの末尾へ移動" }).click();
	await expect(
		page.getByText("末尾の検索対象", { exact: true }),
	).toBeVisible();
	await page.setViewportSize({ width: 1100, height: 740 });
	await settledLayout(conversation);
	await page.getByRole("button", { name: "復元通知を受信" }).click();
	await expect
		.poll(async () => (await readAnchor(conversation)).key)
		.toBe(before.key);
	await expect
		.poll(async () =>
			Math.abs((await readAnchor(conversation)).offset - before.offset),
		)
		.toBeLessThan(2);
	await page.getByRole("button", { name: "応答を受信" }).click();
	await expect(conversation.locator("[data-entry-count]")).toHaveAttribute(
		"data-entry-count",
		"401",
	);
	await expect
		.poll(async () => (await readAnchor(conversation)).key)
		.toBe(before.key);
	await page.screenshot({
		path: join(directory, `${theme}-restored-and-reading.png`),
	});
	await page.getByRole("button", { name: "メッセージの末尾へ移動" }).click();
	await expect(page.getByText("新着の応答", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "承認を受信" }).click();
	await expect(
		page.getByRole("button", { name: "今回のみ許可" }),
	).toBeVisible();
	await expect
		.poll(() =>
			conversation.evaluate(
				(root) =>
					root.scrollHeight - root.clientHeight - root.scrollTop,
			),
		)
		.toBeLessThan(5);
	await page.screenshot({
		path: join(directory, `${theme}-approval-at-end.png`),
	});
}

/** 画面内の先頭行を、総スクロール量から独立した値で観測する。 */
function readAnchor(conversation) {
	return conversation.evaluate((root) => {
		const top = root.getBoundingClientRect().top;
		for (const row of root.querySelectorAll("[data-entry-key]")) {
			if (row.getBoundingClientRect().bottom > top) {
				return {
					key: row.dataset.entryKey,
					offset: row.getBoundingClientRect().top - top,
				};
			}
		}
		return { key: null, offset: 0 };
	});
}

/** 遠く離れた一致へ移動し、無効な正規表現とカードの再マウントも確認する。 */
async function review(page, directory, theme) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-virtualization--long-history&viewMode=story&globals=theme:${theme}`,
	);
	const conversation = page.getByRole("region", {
		name: "会話",
		exact: true,
	});
	const rows = conversation.locator("[data-entry-key]");
	await expect(conversation).toBeVisible({ timeout: 30000 });
	await expect(
		page.getByText("末尾の検索対象", { exact: true }),
	).toBeVisible();
	const initial = await rows.count();
	expect(initial).toBeLessThan(40);
	await page.screenshot({ path: join(directory, `${theme}-bottom.png`) });
	await page.keyboard.press("Control+f");
	const input = page.getByRole("textbox", { name: "会話を検索" });
	await input.fill("装飾語");
	await expect(page.getByLabel("検索結果", { exact: true })).toHaveText(
		"1/1",
	);
	await expect(page.getByText("装飾語", { exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					globalThis.CSS.highlights.get("chat-find-current")?.size ??
					0,
			),
		)
		.toBe(1);
	await page.screenshot({
		path: join(directory, `${theme}-search-markdown.png`),
	});
	await page.getByRole("button", { name: "正規表現" }).click();
	await input.fill("先頭の検索対象|末尾の検索対象");
	await expect(page.getByLabel("検索結果", { exact: true })).toHaveText(
		"1/2",
	);
	await page.keyboard.press("F3");
	await expect(page.getByLabel("検索結果", { exact: true })).toHaveText(
		"2/2",
	);
	await expect(
		page.getByText("末尾の検索対象", { exact: true }),
	).toBeVisible();
	await expect(input).toBeFocused();
	await page.keyboard.press("Shift+F3");
	await expect(page.getByText("装飾語", { exact: true })).toBeVisible();
	await input.fill("[");
	await expect(page.getByRole("alert")).toHaveText(
		"正規表現が正しくありません。",
	);
	await input.fill("折り畳み検索対象");
	await reviewExpansion(page, directory, theme, conversation, input);
	expect(await rows.count()).toBeLessThan(40);
	return {
		theme,
		initial,
		after: await rows.count(),
		total: await conversation
			.locator("[data-entry-count]")
			.getAttribute("data-entry-count"),
	};
}

/** 開いたカードを画面外に出し、再表示と幅変更後の行配置を確認する。 */
async function reviewExpansion(page, directory, theme, conversation, input) {
	await expect(
		page.getByRole("button", { name: /^冒頭ツール/, expanded: true }),
	).toBeVisible();
	await expect(page.getByText(/折り畳み検索対象/).last()).toBeVisible();
	await settledLayout(conversation);
	await page.screenshot({
		path: join(directory, `${theme}-search-tool.png`),
	});
	await input.press("Escape");
	await page.getByRole("button", { name: "メッセージの末尾へ移動" }).click();
	await expect(page.getByRole("button", { name: /^冒頭ツール/ })).toHaveCount(
		0,
	);
	await conversation.hover();
	await page.mouse.wheel(0, -1000000);
	await expect(
		page.getByRole("button", { name: /^冒頭ツール/, expanded: true }),
	).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-remounted-tool.png`),
	});
	await page.setViewportSize({ width: 1100, height: 740 });
	await expect(
		page.getByRole("button", { name: /^冒頭ツール/, expanded: true }),
	).toBeVisible();
	await settledLayout(conversation);
	await page.screenshot({ path: join(directory, `${theme}-wide.png`) });
}

/** 展開と計測が完了してから、隣り合う行に重なりがないことを確認する。 */
async function settledLayout(conversation) {
	await conversation.evaluate(async (root) => {
		await Promise.allSettled(
			root
				.getAnimations({ subtree: true })
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !==
						Infinity,
				)
				.map((animation) => animation.finished),
		);
	});
	await expect
		.poll(() =>
			conversation.evaluate((root) => {
				const rows = [...root.querySelectorAll("[data-entry-key]")];
				for (let index = 1; index < rows.length; index++) {
					if (
						rows[index].getBoundingClientRect().top <
						rows[index - 1].getBoundingClientRect().bottom - 1
					) {
						return false;
					}
				}
				return true;
			}),
		)
		.toBe(true);
}
run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
