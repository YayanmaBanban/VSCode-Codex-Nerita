// 認証パネルの閉鎖とバックエンド切替が、会話の受付と保存設定へ反映されることを確認する。

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { expect } = require("@playwright/test");
const vscode = require("vscode");

/** 未作成と空ファイルを区別し、認証取消しが保存内容を変更していないか比較する。 */
async function credentials() {
	try {
		return await fs.readFile(
			path.join(process.env.PI_CODING_AGENT_DIR, "auth.json"),
			"utf8",
		);
	} catch (error) {
		if (error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

/** メニューの選択が Host の保存設定に届くまで待つ。 */
async function selectBackend(chat, name, id) {
	await chat.getByRole("button", { name: "オプション", exact: true }).click();
	await chat
		.getByRole("menuitem", { name: "バックエンド", exact: true })
		.hover();
	await chat.getByRole("menuitemradio", { name, exact: true }).click();
	await expect
		.poll(() => vscode.workspace.getConfiguration("nerita").get("backend"))
		.toBe(id);
	const settings = JSON.parse(
		await fs.readFile(
			path.join(process.env.NERITA_UI_PROFILE, "User/settings.json"),
			"utf8",
		),
	);
	assert.equal(settings["nerita.backend"], id);
}

/** 実際の入力待ちを閉じた後にも送信でき、切替前の会話が新しい接続へ混入しない。 */
async function verifyAccount(page, chat, model, findFrame) {
	const { before, requests } = await verifyAuthClose(
		page,
		chat,
		model,
		findFrame,
	);
	model.replies.push("認証画面の閉鎖後も送信できました");
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("閉鎖後の会話");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(
		chat.getByText("認証画面の閉鎖後も送信できました", { exact: true }),
	).toBeVisible();
	await selectBackend(chat, "Codex", "codex");
	await expect(
		chat.getByText("認証画面の閉鎖後も送信できました", { exact: true }),
	).toHaveCount(0);
	await expect(
		chat.locator('button[data-connection="auth-required"]'),
	).toBeVisible();
	await selectBackend(chat, "Pi", "pi");
	await expect(
		chat.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	model.replies.push("切替後の Pi が受領しました");
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("新しい接続への要求");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(
		chat.getByText("切替後の Pi が受領しました", { exact: true }),
	).toBeVisible();
	assert.equal(model.requests.length, requests + 2);
	assert.ok(!model.requests.at(-1).includes("閉鎖後の会話"));
	assert.equal(await credentials(), before);
	await page.screenshot({
		path: path.join(
			process.env.NERITA_UI_ARTIFACTS,
			"backend-switched.png",
		),
	});
	const beforeRestore = model.requests.length;
	await chat
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	const previous = chat.getByRole("button", {
		name: "ファイルを作成を開く",
		exact: true,
	});
	await expect(previous).toBeInViewport();
	await previous.click();
	await chat
		.getByRole("button", { name: "セッション一覧を閉じる", exact: true })
		.click();
	const restored = chat.getByText("画面からの承認を受領しました", {
		exact: true,
	});
	await restored.scrollIntoViewIfNeeded();
	await expect(restored).toBeVisible();
	await expect(
		chat.getByText("切替後の Pi が受領しました", { exact: true }),
	).toHaveCount(0);
	assert.equal(
		model.requests.length,
		beforeRestore,
		"履歴復元でモデルへ再送しない",
	);
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "restored.png"),
	});
}

module.exports = { verifyAccount };

/** 認証の未保存入力を閉じても資格情報とモデル送信が変わらないことを確認する。 */
async function verifyAuthClose(page, chat, model, findFrame) {
	const before = await credentials();
	const requests = model.requests.length;
	await chat.getByRole("button", { name: "オプション", exact: true }).click();
	await chat
		.getByRole("menuitem", { name: "認証情報を管理", exact: true })
		.click();
	const auth = await findFrame(page, '[aria-label="認証先を検索"]');
	await auth
		.getByRole("searchbox", { name: "認証先を検索" })
		.fill("anthropic");
	await auth.getByRole("button", { name: "Anthropic", exact: true }).click();
	await auth
		.getByRole("button", { name: "APIキーを設定", exact: true })
		.click();
	await auth
		.locator('input[type="password"]')
		.fill("unsaved-acceptance-value");
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "auth-pending.png"),
	});
	assert.equal(
		vscode.window.tabGroups.activeTabGroup.activeTab.label,
		"Pi 認証情報",
	);
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await expect(
		chat.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	assert.equal(await credentials(), before);
	assert.equal(model.requests.length, requests);
	return { before, requests };
}
