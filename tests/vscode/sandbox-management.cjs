// 配布 Webview の Sandbox 検査と Host コマンド承認の保存・取消しを確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { expect } = require("@playwright/test");

/** 承認前に副作用がないこと、承認の保存状態、取消し後に再び承認を求めることを実行結果と合わせて確認する。 */
async function verifySandboxManagement(page, chat, model, cwd, findFrame) {
	const commands = await vscode.commands.getCommands(true);
	assert.ok(!commands.includes("nerita.pi.setupCodexWindowsSandbox"));
	const { marker, approval } = await verifyHostApproval(chat, model, cwd);

	await vscode.commands.executeCommand("nerita.pi.sandboxSettings");
	let frame = await findFrame(page, 'section[aria-label="コマンドの承認"]');
	await expect(
		frame.getByRole("combobox", { name: "実行環境", exact: true }),
	).toHaveValue("mxc");
	await expect(frame.locator('option[value="docker"]')).toHaveJSProperty(
		"disabled",
		true,
	);
	await frame
		.getByRole("button", { name: "起動を確認", exact: true })
		.click();
	await expect(
		frame.getByRole("button", { name: "起動を確認", exact: true }),
	).toBeEnabled();
	await expect(frame.getByRole("alert")).toHaveCount(0);
	await expect(
		frame.getByText("利用可能 · base-container", { exact: true }),
	).toBeVisible();
	const grants = frame.getByLabel("コマンドの承認");
	await expect(grants).toContainText("pnpm");
	await expect(grants).toContainText("execution");
	await expect(grants).toContainText("host · このワークスペース");
	await reviewSandboxPanel(page, frame);
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await vscode.commands.executeCommand("nerita.pi.sandboxSettings");
	frame = await findFrame(page, 'section[aria-label="コマンドの承認"]');
	await frame
		.getByRole("button", { name: "承認を取り消す", exact: true })
		.click();
	await expect(
		frame.getByText(
			"保持中の承認はありません。必要な実行時に確認します。",
			{ exact: true },
		),
	).toBeVisible();
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await fs.unlink(marker);
	model.replies.push({
		name: "pnpm",
		arguments: { args: ["run", "sandbox-ui"] },
	});
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("取消し後に同じコマンドを要求");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(approval).toBeVisible();
	await assert.rejects(fs.access(marker), { code: "ENOENT" });
	await approval
		.getByRole("button", { name: "キャンセル", exact: true })
		.click();
	await expect(approval).toHaveCount(0);
	await assert.rejects(fs.access(marker), { code: "ENOENT" });
	console.log(
		"VS Code 上の Sandbox 管理画面: MXC 起動検査・ホスト承認の保存・取消し・再承認に成功",
	);
}

/** ローカルの検証用スクリプトも、画面で承認するまでは実行されないことを確認する。 */
async function verifyHostApproval(chat, model, cwd) {
	const marker = path.join(cwd, "sandbox-ui-approved.txt");
	await fs.writeFile(
		path.join(cwd, "package.json"),
		JSON.stringify({
			private: true,
			scripts: {
				"sandbox-ui":
					"node -e \"require('fs').writeFileSync('sandbox-ui-approved.txt','approved')\"",
			},
		}),
	);
	model.replies.push(
		{ name: "pnpm", arguments: { args: ["run", "sandbox-ui"] } },
		"Sandbox 管理画面の検証用コマンドを実行しました",
	);
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("Sandbox のホスト承認を確認");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	const approval = chat.getByLabel("承認要求");
	await expect(approval).toBeVisible();
	await expect(approval).toContainText("execution");
	await expect(approval).toContainText("ホスト");
	await assert.rejects(fs.access(marker), { code: "ENOENT" });
	await approval
		.getByRole("button", { name: "このワークスペース", exact: true })
		.click();
	await expect(
		chat.getByText("Sandbox 管理画面の検証用コマンドを実行しました", {
			exact: true,
		}),
	).toBeVisible();
	assert.equal(await fs.readFile(marker, "utf8"), "approved");

	return { marker, approval };
}

/** VS Code 上で明暗テーマと表示幅を切り替え、制約と承認の表示を記録する。 */
async function reviewSandboxPanel(page, frame) {
	const themes = vscode.extensions.getExtension("vscode.theme-defaults")
		.packageJSON.contributes.themes;
	for (const kind of ["vs", "vs-dark"]) {
		const theme = themes.find((entry) => entry.uiTheme === kind);
		assert.ok(theme);
		await vscode.workspace
			.getConfiguration("workbench")
			.update(
				"colorTheme",
				theme.id ?? theme.label,
				vscode.ConfigurationTarget.Global,
			);
		await expect(frame.locator("body")).toHaveClass(
			new RegExp(kind === "vs" ? "vscode-light" : "vscode-dark"),
		);
		for (const width of [1400, 900]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(frame.getByLabel("現在のMXCの制約")).toContainText(
				"ワークスペース外の読み取りを防ぐことは保証できません。",
			);
			await frame.getByLabel("コマンドの承認").scrollIntoViewIfNeeded();
			await expect(
				frame.getByRole("button", {
					name: "承認を取り消す",
					exact: true,
				}),
			).toBeInViewport();
			const applied = await frame.evaluate(() => ({
				width: globalThis.innerWidth,
				overflow:
					globalThis.document.documentElement.scrollWidth >
					globalThis.innerWidth,
				background: globalThis.getComputedStyle(
					globalThis.document.body,
				).backgroundColor,
				foreground: globalThis.getComputedStyle(
					globalThis.document.body,
				).color,
			}));
			assert.equal(applied.overflow, false);
			assert.notEqual(applied.background, applied.foreground);
			const basename = `sandbox-${kind}-${width}`;
			await fs.writeFile(
				path.join(process.env.NERITA_UI_ARTIFACTS, `${basename}.json`),
				JSON.stringify(applied, null, 2),
			);
			await page.screenshot({
				path: path.join(
					process.env.NERITA_UI_ARTIFACTS,
					`${basename}.png`,
				),
			});
		}
	}
}

module.exports = { verifySandboxManagement };
