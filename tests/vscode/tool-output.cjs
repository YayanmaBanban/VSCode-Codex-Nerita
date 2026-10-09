// 配布した Webview から出力を取得し、再接続とフォーク後の本文を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { expect } = require("@playwright/test");

/** モデルだけを代替し、本文は SDK 本体のツールと保存済み履歴から取得する。 */
async function verifyToolOutput(page, chat, model, cwd) {
	await fs.writeFile(
		path.join(cwd, "perf-output.txt"),
		`出力の先頭🐈\n${"日本語の出力です。\n".repeat(600)}出力の末尾`,
		"utf8",
	);
	model.replies.push(
		{ name: "read", arguments: { path: "perf-output.txt" } },
		"出力の検証が完了しました",
	);
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("長い出力を確認");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(
		chat.getByText("出力の検証が完了しました", { exact: true }),
	).toBeVisible();
	await inspectOutput(page, chat, "output-live.png");
	const requests = model.requests.length;
	await chat
		.getByRole("button", { name: "新しいチャット", exact: true })
		.click();
	await expect(
		chat.getByRole("status", { name: "接続済み", exact: true }),
	).toBeVisible();
	await expect(
		chat.locator(".tool-card").filter({ hasText: "perf-output.txt" }),
	).toHaveCount(0);
	await openSaved(chat, "ファイルを作成を開く");
	await inspectOutput(page, chat, "output-restored.png");
	await openSaved(chat, "ファイルを作成をフォーク");
	await inspectOutput(page, chat, "output-forked.png");
	assert.equal(
		model.requests.length,
		requests,
		"復元とフォークではツールを再実行しない",
	);
}

/** カードを開くまで詳細を描画せず、取得した本文の Unicode と末尾を確認する。 */
async function inspectOutput(page, chat, screenshot) {
	const card = chat
		.locator(".tool-card")
		.filter({ hasText: "perf-output.txt" });
	await expect(card.locator(".tool-heading")).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await card.locator(".tool-heading").click();
	await card.getByRole("button", { name: "詳細出力", exact: true }).click();
	const detail = card.getByRole("region", { name: "詳細出力" });
	await expect(detail).toHaveAttribute("aria-busy", "false");
	await expect(detail).toContainText("出力の先頭🐈");
	await expect(detail).toContainText("出力の末尾");
	assert.ok(!(await detail.innerText()).includes("�"));
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, screenshot),
	});
	await card.getByRole("button", { name: "詳細出力", exact: true }).click();
	await expect(detail).toHaveCount(0);
	await card.locator(".tool-heading").click();
}

/** 履歴一覧の公開操作だけで、保存した会話を開くか分岐する。 */
async function openSaved(chat, label) {
	await chat
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	const items = chat
		.getByRole("list", { name: "セッション履歴" })
		.getByRole("listitem");
	const count = await items.count();
	await chat.getByRole("button", { name: label, exact: true }).click();
	if (label.endsWith("をフォーク")) {
		await expect(items).toHaveCount(count + 1);
		await expect(
			chat.locator('.session-item button[aria-current="true"]'),
		).toHaveCount(1);
	} else {
		await expect(
			chat.getByRole("button", { name: label, exact: true }),
		).toHaveAttribute("aria-current", "true");
	}
	await chat
		.getByRole("button", { name: "セッション一覧を閉じる", exact: true })
		.click();
}

module.exports = { verifyToolOutput };
