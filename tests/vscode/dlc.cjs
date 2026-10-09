// 配布済み Host の Intent UI を操作し、共通の実行・承認と保存を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { expect } = require("@playwright/test");

function executionPrompt(request) {
	const body = JSON.parse(request);
	const message = body.messages
		.filter((entry) => entry.role === "user")
		.at(-1);
	return typeof message.content === "string"
		? message.content
		: message.content.map((part) => part.text ?? "").join("\n");
}
function resultContract(request, outcome = "implemented") {
	const line = executionPrompt(request)
		.split("\n")
		.find((value) => value.startsWith('{"attemptId":'));
	assert.ok(line, "モデルへ実行世代を含む結果契約が届くこと");
	const contract = JSON.parse(line);
	return JSON.stringify({
		attemptId: contract.attemptId,
		workItemId: contract.workItemId,
		outcome,
		summary:
			outcome === "implemented"
				? "DLC のファイルを作成した"
				: "承認されなかった",
		changedPaths: outcome === "implemented" ? ["dlc.txt"] : [],
	});
}
async function createIntent(editor, title) {
	const titleField = editor.getByLabel("Intent のタイトル", { exact: true });
	await titleField.click();
	await titleField.fill(title);
	await expect(titleField).toHaveValue(title);
	await editor
		.getByLabel("開発したい内容", { exact: true })
		.fill("  原文のまま\nDLC の作業を実行する  ");
	await editor.getByText("詳細設定", { exact: true }).click();
	await editor
		.getByLabel("実行プロファイル", { exact: true })
		.selectOption("classic");
	await editor
		.getByRole("button", { name: "Intent を作成", exact: true })
		.click();
	const selected = editor.getByRole("button", { name: title, exact: true });
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	return selected.getAttribute("data-intent-id");
}
async function openConstruction(editor) {
	const phase = editor.getByRole("button", {
		name: /Phase 3 · Construction/,
	});
	if ((await phase.getAttribute("aria-expanded")) !== "true") {
		await phase.click();
	}
}
async function plan(editor, filename) {
	await openConstruction(editor);
	await editor.getByLabel("タスク名", { exact: true }).fill("ファイルを作成");
	await editor
		.getByLabel("実装する内容", { exact: true })
		.fill(`${filename} に dlc と書く`);
	await editor
		.getByLabel("対象ファイル（相対パス、カンマ区切り）", { exact: true })
		.fill(filename);
	await editor
		.getByRole("button", { name: "プランを登録", exact: true })
		.click();
	await expect(
		editor.getByRole("button", { name: "手動タスクを実行", exact: true }),
	).toBeEnabled();
}
async function screenshot(page, name) {
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, name),
	});
}
async function prepareRepository(cwd) {
	execFileSync("git", ["init", cwd], { windowsHide: true });
	await fs.writeFile(path.join(cwd, "dlc-base.txt"), "base\n");
	execFileSync("git", ["-C", cwd, "add", "dlc-base.txt"], {
		windowsHide: true,
	});
	execFileSync(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-m",
			"DLC fixture",
		],
		{ windowsHide: true },
	);
}
async function switchPendingIntent(page, chat, editor) {
	await chat.getByRole("button", { name: "Chat", exact: true }).click();
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await expect(chat.getByLabel("Codexへのメッセージ")).toBeVisible();
	await chat.getByRole("button", { name: "DLC", exact: true }).click();
	await editor
		.getByRole("button", { name: "新しい Intent", exact: true })
		.click();
	const second = await createIntent(editor, "別の Intent");
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await expect(
		editor.getByRole("button", { name: "画面からの Intent", exact: true }),
	).toContainText("実行中");
	await screenshot(page, "dlc-other-intent.png");
	await chat
		.getByRole("button", { name: "実行中の Intent を表示", exact: true })
		.click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	return second;
}
async function verifyDlc(page, chat, model, cwd, findFrame) {
	await prepareRepository(cwd);
	await page.setViewportSize({ width: 1400, height: 900 });
	await chat.getByRole("button", { name: "DLC", exact: true }).click();
	let editor = await findFrame(page, ".dlc-workspace");
	await expect(chat.getByLabel("Intent のタイトル")).toHaveCount(0);
	await screenshot(page, "dlc-create.png");
	const first = await createIntent(editor, "画面からの Intent");
	await expect(
		editor.getByRole("button", { name: /Phase 0 · Initialization/ }),
	).toContainText("完了");
	await plan(editor, "dlc.txt");
	await screenshot(page, "dlc-plan.png");
	model.replies.push({
		name: "write",
		arguments: { path: "dlc.txt", content: "dlc\n" },
	});
	const count = model.requests.length;
	await editor
		.getByRole("button", { name: "手動タスクを実行", exact: true })
		.click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	await expect.poll(() => model.requests.length).toBe(count + 1);
	const prompt = executionPrompt(model.requests.at(-1));
	await verifyPrompt(chat, prompt);
	await assert.rejects(fs.stat(path.join(cwd, "dlc.txt")), {
		code: "ENOENT",
	});
	await screenshot(page, "dlc-approval.png");
	const second = await switchPendingIntent(page, chat, editor);
	assert.notEqual(first, second);
	editor = await reopenWorkspace(page, chat, editor, findFrame);
	await expect(
		editor.getByRole("button", { name: /Phase 3 · Construction/ }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(
		editor.getByRole("button", { name: /Phase 0 · Initialization/ }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(
		editor.getByRole("button", { name: "画面からの Intent", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	assert.equal(model.requests.length, count + 1);
	model.replies.push(resultContract(model.requests.at(-1)));
	await chat
		.getByLabel("承認要求")
		.getByRole("button", { name: "今回のみ許可", exact: true })
		.click();
	await expect(editor.getByLabel("手動タスク")).toContainText(
		"実装済み・レビュー待ち",
	);
	await expect(
		editor.getByRole("button", { name: "画面からの Intent", exact: true }),
	).toContainText("レビュー待ち");
	assert.equal(await fs.readFile(path.join(cwd, "dlc.txt"), "utf8"), "dlc\n");
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await screenshot(page, "dlc-result.png");
	await editor.getByRole("button", { name: "再読込み", exact: true }).click();
	await editor
		.getByRole("button", { name: "実行 1 · 実行終了", exact: true })
		.click();
	await verifyPrompt(chat, prompt);
	await verifyDeniedAndStopped(page, chat, editor, model, cwd, second);
	await reviewWorkspace(page, editor);
	await chat.getByRole("button", { name: "Chat", exact: true }).click();
	await expect(chat.getByLabel("Codexへのメッセージ")).toBeVisible();
	await expect(
		chat.getByText("画面からの承認を受領しました", { exact: true }),
	).toBeVisible();
	console.log(
		"DLC: 独立エディタ・Phase 表示・チャット連携・再表示・承認・拒否・停止・履歴に成功",
	);
}
async function verifyPrompt(chat, prompt) {
	await chat.getByText("送信した実行内容（全文）", { exact: true }).click();
	await expect(
		chat.getByLabel("送信した実行内容", { exact: true }),
	).toHaveText(prompt);
	await chat.getByText("送信した実行内容（全文）", { exact: true }).click();
}

/** 操作画面の破棄で実行を止めず、展開位置を新しい Webview へ復元する。 */
async function reopenWorkspace(page, chat, editor, findFrame) {
	await openConstruction(editor);
	await editor
		.getByRole("button", { name: /Phase 0 · Initialization/ })
		.click();
	await require("vscode").commands.executeCommand(
		"workbench.action.closeActiveEditor",
	);
	await expect.poll(() => editor.isDetached()).toBe(true);
	await chat
		.getByRole("button", { name: "DLC の作業画面を開く", exact: true })
		.click();
	return findFrame(page, ".dlc-workspace");
}
async function verifyDeniedAndStopped(
	page,
	chat,
	editor,
	model,
	cwd,
	intentId,
) {
	await editor.locator(`[data-intent-id="${intentId}"]`).click();
	await plan(editor, "denied.txt");
	model.replies.push({
		name: "write",
		arguments: { path: "denied.txt", content: "blocked" },
	});
	await editor
		.getByRole("button", { name: "手動タスクを実行", exact: true })
		.click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	model.replies.push(resultContract(model.requests.at(-1), "blocked"));
	await chat
		.getByLabel("承認要求")
		.getByRole("button", { name: "拒否", exact: true })
		.click();
	await expect(editor.getByLabel("手動タスク")).toContainText("失敗");
	await assert.rejects(fs.stat(path.join(cwd, "denied.txt")), {
		code: "ENOENT",
	});
	await screenshot(page, "dlc-denied.png");
	await editor
		.getByRole("button", {
			name: "変更を確認して再試行を準備",
			exact: true,
		})
		.click();
	await expect(
		editor.getByRole("button", { name: "手動タスクを実行", exact: true }),
	).toBeEnabled();
	model.replies.push({
		name: "write",
		arguments: { path: "denied.txt", content: "blocked" },
	});
	await editor
		.getByRole("button", { name: "手動タスクを実行", exact: true })
		.click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	await editor
		.getByRole("button", { name: "実行を停止", exact: true })
		.click();
	await expect(editor.getByLabel("手動タスク")).toContainText("停止済み");
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await assert.rejects(fs.stat(path.join(cwd, "denied.txt")), {
		code: "ENOENT",
	});
	await screenshot(page, "dlc-stopped.png");
}
async function reviewWorkspace(page, editor) {
	const vscode = require("vscode");
	const themes = vscode.extensions.getExtension("vscode.theme-defaults")
		.packageJSON.contributes.themes;
	for (const kind of ["vs", "vs-dark"]) {
		const theme = themes.find((entry) => entry.uiTheme === kind);
		await vscode.workspace
			.getConfiguration("workbench")
			.update(
				"colorTheme",
				theme.id ?? theme.label,
				vscode.ConfigurationTarget.Global,
			);
		await expect(editor.locator("body")).toHaveClass(
			new RegExp(kind === "vs" ? "vscode-light" : "vscode-dark"),
		);
		for (const width of [1400, 1000]) {
			await page.setViewportSize({ width, height: 900 });
			await editor
				.getByRole("heading", { name: "別の Intent", exact: true })
				.scrollIntoViewIfNeeded();
			const size = await editor.evaluate(() => ({
				width: globalThis.document.documentElement.clientWidth,
				content: globalThis.document.documentElement.scrollWidth,
			}));
			assert.ok(size.content <= size.width, JSON.stringify(size));
			await screenshot(page, `dlc-workspace-${kind}-${width}.png`);
		}
	}
	await page.setViewportSize({ width: 1000, height: 800 });
}
module.exports = { verifyDlc };
