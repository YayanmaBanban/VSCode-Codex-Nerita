// VS Code 上の Webview を操作し、Host・SDK を経由したファイルへの反映を確認する。

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const vscode = require("vscode");
const { verifyToolOutput } = require("./tool-output.cjs");

/** 指定した要素のある Webview フレームを探し、見つからなければ検証を失敗させる。 */
async function findFrame(page, selector) {
	let found;
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					try {
						if (
							!frame.isDetached() &&
							(await frame.locator(selector).count())
						) {
							found = frame;
							return true;
						}
					} catch (error) {
						if (!frame.isDetached()) {
							throw error;
						}
					}
				}
				return false;
			},
			{ timeout: 20000 },
		)
		.toBe(true);
	return found;
}

/** 実サービスの認証情報を使わず、ローカルモデルを設定する。 */
async function prepareModel(url, cwd) {
	const agent = process.env.PI_CODING_AGENT_DIR;
	await fs.mkdir(agent, { recursive: true });
	await fs.writeFile(
		path.join(agent, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: url,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: [
						{
							id: "test-model",
							reasoning: false,
							input: ["text"],
							contextWindow: 100000,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
	await fs.mkdir(path.join(cwd, ".nerita"), { recursive: true });
	await fs.writeFile(
		path.join(cwd, ".nerita/config.toml"),
		'[pi]\nprovider="local"\nmodel="test-model"\n',
	);
}

/** 専用プロファイルのテーマを選び、VS Code 上の Webview に届いた色と幅を記録する。 */
async function reviewViewport(page, chat, themeKind) {
	const themes = vscode.extensions.getExtension("vscode.theme-defaults")
		.packageJSON.contributes.themes;
	const theme = themes.find((entry) => entry.uiTheme === themeKind);
	assert.ok(theme);
	await vscode.workspace
		.getConfiguration("workbench")
		.update(
			"colorTheme",
			theme.id ?? theme.label,
			vscode.ConfigurationTarget.Global,
		);
	await page.setViewportSize({ width: 1000, height: 800 });
	await expect(chat.locator("body")).toHaveClass(
		new RegExp(themeKind === "vs" ? "vscode-light" : "vscode-dark"),
	);
	const applied = await chat.evaluate(() => ({
		width: globalThis.innerWidth,
		theme: globalThis.document.body.dataset.vscodeThemeKind,
		background: globalThis.getComputedStyle(globalThis.document.body)
			.backgroundColor,
		foreground: globalThis.getComputedStyle(globalThis.document.body).color,
	}));
	assert.ok(
		applied.width > 0 && applied.width <= 420,
		JSON.stringify(applied),
	);
	assert.notEqual(applied.background, applied.foreground);
	await fs.writeFile(
		path.join(
			process.env.NERITA_UI_ARTIFACTS,
			`viewport-${themeKind}.json`,
		),
		JSON.stringify(applied, null, 2),
	);
	return applied;
}

/** 信頼操作・再接続・承認・停止を、配布物の UI と公開コマンドで行う。 */
async function run() {
	const model = await require(process.env.NERITA_UI_MODEL).modelServer();
	let browser;
	let page;
	const errors = [];
	try {
		const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
		await prepareModel(model.url, cwd);
		const port = (
			await fs.readFile(
				path.join(process.env.NERITA_UI_PROFILE, "DevToolsActivePort"),
				"utf8",
			)
		).split("\n")[0];
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		page = browser.contexts()[0].pages()[0];
		await page
			.context()
			.tracing.start({ screenshots: true, snapshots: true });
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (
				message.type() === "error" &&
				message.location().url.startsWith("vscode-webview:")
			) {
				errors.push(message.text());
			}
		});
		page.setDefaultTimeout(15000);
		await vscode.commands.executeCommand("nerita.trust.manage");
		// 信頼管理画面は独立した Webview として表示される。
		const manager = await findFrame(
			page,
			'input[placeholder="名前またはパスで検索"]',
		);
		await manager
			.getByRole("button", { name: "信頼する", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Trust this root", exact: true })
			.click();
		await vscode.commands.executeCommand("nerita.codex.openChat");
		const chat = await findFrame(
			page,
			'[aria-label="Codexへのメッセージ"]',
		);
		await chat.locator("button[data-connection]").click();
		await expect(
			chat.getByRole("button", { name: "接続済み", exact: true }),
		).toBeVisible();
		const { light } = await verifyApprovedWrite(model, page, chat, cwd);
		await verifyStoppedWrite(model, page, chat, cwd, light);
		console.log(
			"実 Webview: 信頼操作・再接続・承認付き書込み・停止に成功",
			process.env.NERITA_UI_ARTIFACTS,
		);
		assert.deepEqual(errors, []);
		await require("./account.cjs").verifyAccount(
			page,
			chat,
			model,
			findFrame,
		);
		await verifyToolOutput(page, chat, model, cwd);
		assert.deepEqual(errors, []);
	} finally {
		if (page) {
			await page.screenshot({
				path: path.join(process.env.NERITA_UI_ARTIFACTS, "last.png"),
			});
			await page.context().tracing.stop({
				path: path.join(process.env.NERITA_UI_ARTIFACTS, "trace.zip"),
			});
		}
		await browser?.close();
		await model.close();
	}
}

module.exports = { run };

/** 承認前にファイルが作成されていないことと、画面から承認した後のファイル内容を確認する。 */
async function verifyApprovedWrite(model, page, chat, cwd) {
	model.replies.push(
		{
			name: "write",
			arguments: { path: "ui.txt", content: "approved" },
		},
		"画面からの承認を受領しました",
	);
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("ファイルを作成");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	const light = await reviewViewport(page, chat, "vs");
	await expect(
		chat.getByRole("button", { name: "今回のみ許可", exact: true }),
	).toBeInViewport();
	await expect(
		chat.getByRole("button", { name: "停止", exact: true }),
	).toBeInViewport();
	await assert.rejects(fs.access(path.join(cwd, "ui.txt")), {
		code: "ENOENT",
	});
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "approval.png"),
	});
	await chat
		.getByLabel("承認要求")
		.getByRole("button", { name: "今回のみ許可", exact: true })
		.click();
	await expect(
		chat.getByText("画面からの承認を受領しました", { exact: true }),
	).toBeVisible();
	assert.equal(
		await fs.readFile(path.join(cwd, "ui.txt"), "utf8"),
		"approved",
	);
	return { light };
}

/** 暗いテーマで停止を操作し、承認待ちの書込みが実行されないことを確認する。 */
async function verifyStoppedWrite(model, page, chat, cwd, light) {
	model.replies.push({
		name: "write",
		arguments: { path: "stopped.txt", content: "blocked" },
	});
	await chat
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("次の書込みを停止");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(chat.getByLabel("承認要求")).toBeVisible();
	const dark = await reviewViewport(page, chat, "vs-dark");
	assert.notEqual(light.background, dark.background);
	await expect(
		chat.getByRole("button", { name: "停止", exact: true }),
	).toBeInViewport();
	await chat.getByRole("button", { name: "停止", exact: true }).click();
	await expect(chat.getByLabel("承認要求")).toHaveCount(0);
	await expect(
		chat.getByRole("button", { name: "停止", exact: true }),
	).toHaveCount(0);
	await assert.rejects(fs.access(path.join(cwd, "stopped.txt")), {
		code: "ENOENT",
	});
	await page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, "stopped.png"),
	});
}
