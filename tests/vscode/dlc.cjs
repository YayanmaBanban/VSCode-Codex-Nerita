// 配布済み Host の DLC コマンドを実画面から操作し、独立した実行の承認と表示を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { expect } = require("@playwright/test");
const vscode = require("vscode");

/** 標準の Quick Input のタイトルを待ち、前の入力欄へ誤送信しない。 */
async function input(page, title, value) {
	await expect(page.locator(".quick-input-title")).toHaveText(title);
	const field = page.locator(".quick-input-widget .monaco-inputbox input");
	await field.fill(value);
	await field.press("Enter");
}

/** セッション識別子を推測せず、モデルが実際に受け取った結果契約へ応答する。 */
function resultContract(request) {
	const body = JSON.parse(request);
	const message = body.messages
		.filter((entry) => entry.role === "user")
		.at(-1);
	const text =
		typeof message.content === "string"
			? message.content
			: message.content.map((part) => part.text ?? "").join("\n");
	const line = text
		.split("\n")
		.find((value) => value.startsWith('{"attemptId":'));
	assert.ok(line, "モデルへ実行世代を含む結果契約が届くこと");
	const contract = JSON.parse(line);
	return JSON.stringify({
		attemptId: contract.attemptId,
		workItemId: contract.workItemId,
		outcome: "implemented",
		summary: "DLC のファイルを作成した",
		changedPaths: ["dlc.txt"],
	});
}

/** Goal → Plan → Task → Implement を、本番のコマンド登録と SDK を通して実行する。 */
async function verifyDlc(page, model, cwd) {
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
	const create = vscode.commands.executeCommand("nerita.dlc.create");
	await input(page, "DLC: プロジェクトの目標", "DLC の作業を実行する");
	await create;
	const plan = vscode.commands.executeCommand("nerita.dlc.plan");
	await input(page, "DLC: 作業名", "ファイルを作成");
	await input(page, "DLC: 実装する内容", "dlc.txt に dlc と書く");
	await input(page, "DLC: 対象ファイル", "dlc.txt");
	await expect(page.locator(".quick-input-title")).toHaveText(
		"DLC: 1件の作業",
	);
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "dlc-plan.png"),
	});
	await page.getByText("このプランを登録", { exact: true }).click();
	await plan;
	const previousRequests = model.requests.length;
	model.replies.push({
		name: "write",
		arguments: { path: "dlc.txt", content: "dlc\n" },
	});
	const run = vscode.commands.executeCommand("nerita.dlc.run");
	await expect(page.locator(".quick-input-title")).toContainText("DLC:");
	await expect(page.locator(".quick-input-list")).toContainText("dlc.txt");
	await page.getByText("実行条件と入力内容を確認", { exact: true }).click();
	await expect(
		page.locator(".monaco-editor").getByText("入力内容:", { exact: true }),
	).toBeVisible();
	await expect.poll(() => model.requests.length).toBe(previousRequests + 1);
	await assert.rejects(fs.stat(path.join(cwd, "dlc.txt")), {
		code: "ENOENT",
	});
	model.replies.push(resultContract(model.requests.at(-1)));
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "dlc-approval.png"),
	});
	await page
		.locator(".quick-input-list")
		.getByText("今回のみ許可", { exact: true })
		.click();
	await run;
	assert.equal(await fs.readFile(path.join(cwd, "dlc.txt"), "utf8"), "dlc\n");
	await expect(
		page.getByText("段階: awaiting-review", { exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "dlc-result.png"),
	});
	console.log("DLC: Goal・Plan・承認付き実装・レビュー待ちの表示に成功");
}

module.exports = { verifyDlc };
