// 実際の管理画面と SecretStorage を使い、参照の保存・認証設定・削除を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { expect } = require("@playwright/test");

/** UI が送信した Binding を、Host が保存した実ファイルと比較する。 */
async function verifyCredentials(page, cwd, findFrame) {
	await vscode.commands.executeCommand("nerita.credentials.manage");
	let frame = await findFrame(page, 'section[aria-label="Binding"]');
	await frame
		.getByLabel("Binding ID", { exact: true })
		.fill("acceptance-api");
	await frame.getByLabel("対象", { exact: true }).fill("npm.example.test");
	await frame
		.getByLabel("シークレット ID", { exact: true })
		.fill("2863ced6-eba1-48b4-b5c0-afa30104877a");
	await frame
		.getByLabel("プロジェクト ID（任意）", { exact: true })
		.fill("2863ced6-eba1-48b4-b5c0-afa30104877b");
	await frame
		.getByRole("button", { name: "Binding を保存", exact: true })
		.click();
	const file = path.join(cwd, ".nerita/bindings.json");
	await expect.poll(async () => (await readBindings(file)).length).toBe(1);
	const saved = JSON.parse(await fs.readFile(file, "utf8"));
	assert.equal(
		saved.bindings[0].provider.projectId,
		"2863ced6-eba1-48b4-b5c0-afa30104877b",
	);
	assert.equal(
		await fs.readFile(path.join(cwd, ".nerita/.gitignore"), "utf8"),
		"/bindings.json\n",
	);
	await frame.getByRole("button", { name: "編集", exact: true }).click();
	await frame
		.getByLabel("対象", { exact: true })
		.fill("packages.example.test");
	await frame
		.getByRole("button", { name: "Binding を保存", exact: true })
		.click();
	await expect
		.poll(async () => (await readBindings(file))[0]?.match.target)
		.toBe("packages.example.test");
	await verifyBwsStorage(page, frame);
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await vscode.commands.executeCommand("nerita.credentials.manage");
	frame = await findFrame(page, 'section[aria-label="Binding"]');
	await expect(
		frame.getByText(/Bitwarden Secrets Manager.*認証済み.*VS Code に保存/),
	).toBeVisible();
	await frame
		.getByRole("button", { name: "Bitwarden の認証を削除", exact: true })
		.click();
	await expect(
		frame.getByText(/Bitwarden Secrets Manager.*未認証/),
	).toBeVisible();
	await frame.getByRole("button", { name: "削除", exact: true }).click();
	await expect.poll(async () => (await readBindings(file)).length).toBe(0);
	await page.screenshot({
		path: path.join(
			process.env.NERITA_UI_ARTIFACTS,
			"credentials-managed.png",
		),
	});
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
}

/** 秘密値は Webview へ入力せず、VS Code の password 入力経由で保存する。 */
async function verifyBwsStorage(page, frame) {
	await frame
		.getByRole("button", { name: "Bitwarden の認証を設定", exact: true })
		.click();
	const input = page.locator(".quick-input-widget input").first();
	await expect(input).toBeVisible();
	await input.fill("bws-acceptance-private");
	await input.press("Enter");
	await expect(
		frame.getByText(/Bitwarden Secrets Manager.*認証済み.*VS Code に保存/),
	).toBeVisible();
	assert.ok(
		!(await frame.locator("body").innerText()).includes(
			"bws-acceptance-private",
		),
	);
}
module.exports = { verifyCredentials };

/** 最初の非同期保存が完了する前は、Binding がまだない状態として待つ。 */
async function readBindings(file) {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")).bindings;
	} catch (error) {
		if (error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}
