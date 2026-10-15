// 配布済み Host で Worktree を作成・信頼・選択し、並行した承認と対象だけの停止を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { expect } = require("@playwright/test");
const {
	createIntent,
	plan,
	resultContract,
	screenshot,
	reviewWorkspace,
} = require("./dlc.cjs");

async function createTargets(page, editor, findFrame) {
	const select = editor.getByLabel("DLC の Worktree");
	const targets = [];
	for (let index = 0; index < 2; index++) {
		const previous = await select
			.locator("option")
			.evaluateAll((options) => options.map((option) => option.value));
		await editor
			.getByRole("button", { name: "Worktree を作成", exact: true })
			.click();
		await expect(select.locator("option")).toHaveCount(previous.length + 1);
		const current = await select
			.locator("option")
			.evaluateAll((options) => options.map((option) => option.value));
		targets.push(current.find((id) => !previous.includes(id)));
	}
	await vscode.commands.executeCommand("nerita.trust.manage");
	const trust = await findFrame(page, 'input[type="search"]');
	const articles = trust.locator("article").filter({
		has: trust.getByRole("heading", { name: /work-[a-f0-9]+/ }),
	});
	await expect(articles).toHaveCount(2);
	for (let index = 0; index < 2; index++) {
		await articles
			.nth(index)
			.getByRole("button", { name: "信頼する", exact: true })
			.click();
		await trust
			.getByRole("button", {
				name: "このフォルダを信頼する",
				exact: true,
			})
			.click();
		await expect(
			articles
				.nth(index)
				.getByRole("button", { name: "信頼を取り消す", exact: true }),
		).toBeEnabled();
	}
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await editor
		.getByRole("button", { name: "再読み込み", exact: true })
		.click();
	await expect(select.locator("option")).toHaveCount(3);
	return targets;
}

async function addIntent(editor, title, targetId) {
	await editor
		.getByRole("button", { name: "Intentの作成", exact: true })
		.click();
	const id = await createIntent(editor, title);
	await editor.getByLabel("DLC のバックエンド").selectOption("pi");
	await editor.getByLabel("DLC の Worktree").selectOption(targetId);
	await expect(editor.getByLabel("DLC の Worktree")).toHaveValue(targetId);
	await expect(editor.getByLabel("DLC の Worktree")).toBeEnabled();
	const directory = (
		await editor.getByText(/^実行ディレクトリ:/).innerText()
	).slice("実行ディレクトリ: ".length);
	await plan(editor, "dlc.txt");
	await expect(editor.getByRole("alert")).toHaveCount(0);
	return { id, directory };
}
async function launch(editor, model) {
	model.replies.push({
		name: "write",
		arguments: { path: "dlc.txt", content: "dlc\n" },
	});
	await editor
		.getByRole("button", { name: "手動タスクを実行", exact: true })
		.click();
	await expect(
		editor.getByLabel("Worktree の会話").getByLabel("承認要求"),
	).toBeVisible();
	return model.requests.at(-1);
}

async function verifyWorktrees(page, chat, model, findFrame) {
	await page.setViewportSize({ width: 1400, height: 900 });
	await chat.getByRole("button", { name: "DLC", exact: true }).click();
	await vscode.commands.executeCommand("nerita.dlc.openWorkspace");
	const editor = await findFrame(page, ".dlc-workspace");
	const conversation = editor.getByLabel("Worktree の会話");
	const targets = await createTargets(page, editor, findFrame);
	const a = await addIntent(editor, "Worktree A の作業", targets[0]);
	const b = await addIntent(editor, "Worktree B の作業", targets[1]);
	await editor.locator(`[data-intent-id="${a.id}"]`).click();
	await expect(editor.getByLabel("DLC の Worktree")).toHaveValue(targets[0]);
	await launch(editor, model);
	await editor.locator(`[data-intent-id="${b.id}"]`).click();
	await expect(editor.getByLabel("承認要求")).toHaveCount(0);
	await verifyStartHold(page, editor, model, targets);
	await expect(
		editor.getByRole("button", { name: "手動タスクを実行", exact: true }),
	).toBeEnabled();
	const request = await launch(editor, model);
	await conversation.scrollIntoViewIfNeeded();
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await expect(chat.getByLabel("Codexへのメッセージ")).toBeVisible();
	await screenshot(page, "dlc-worktrees-pending.png");
	await expect(
		conversation.getByText(/Intent の選択または版が変更されています/),
	).toHaveCount(0);
	await expect(
		conversation.getByText(/ワークスペースの信頼設定が変更されました/),
	).toHaveCount(0);
	await editor.locator(`[data-intent-id="${a.id}"]`).click();
	await conversation
		.getByRole("button", { name: "DLC の会話を停止", exact: true })
		.click();
	await expect(
		conversation.getByRole("button", {
			name: "DLC の会話を停止",
			exact: true,
		}),
	).toHaveCount(0);
	await editor.locator(`[data-intent-id="${b.id}"]`).click();
	await expect(conversation.getByLabel("承認要求")).toBeVisible();
	model.replies.push(resultContract(request));
	await conversation
		.getByLabel("承認要求")
		.getByRole("button", { name: "今回のみ許可", exact: true })
		.click();
	await expect
		.poll(() =>
			fs
				.readFile(path.join(b.directory, "dlc.txt"), "utf8")
				.catch(() => null),
		)
		.toBe("dlc\n");
	await assert.rejects(fs.stat(path.join(a.directory, "dlc.txt")), {
		code: "ENOENT",
	});
	await editor
		.getByRole("button", { name: "Worktree を削除", exact: true })
		.click();
	await expect(editor.getByRole("alert")).toBeVisible();
	assert.equal(
		await fs.readFile(path.join(b.directory, "dlc.txt"), "utf8"),
		"dlc\n",
	);
	await screenshot(page, "dlc-worktrees-result.png");
	console.log(
		"DLC Worktree: UI で作成・信頼・並行承認・対象の停止・実書込み・削除拒否を確認",
	);
}

/** 共有する実行先の保留から、既存 Run を止めずに作成・再確認・独立 Worktree の選択へ進む。 */
async function verifyStartHold(page, editor, model, targets) {
	const select = editor.getByLabel("DLC の Worktree");
	const requests = model.requests.length;
	await select.selectOption(targets[0]);
	const hold = editor.getByLabel("実行開始の保留");
	await expect(hold).toBeVisible();
	await expect(
		editor.getByRole("button", { name: "手動タスクを実行", exact: true }),
	).toBeDisabled();
	await reviewWorkspace(page, editor, "実行開始の保留", "dlc-start-hold");
	await editor
		.getByRole("button", { name: "Worktree を作成", exact: true })
		.click();
	await expect(select.locator("option")).toHaveCount(4);
	await editor
		.getByRole("button", { name: "再読み込み", exact: true })
		.click();
	await expect(hold).toBeVisible();
	assert.equal(model.requests.length, requests);
	await select.selectOption(targets[1]);
	await expect(hold).toHaveCount(0);
	await expect(
		editor.getByRole("button", { name: "手動タスクを実行", exact: true }),
	).toBeEnabled();
	assert.equal(model.requests.length, requests);
	await page.setViewportSize({ width: 1400, height: 900 });
}
module.exports = { verifyWorktrees };
