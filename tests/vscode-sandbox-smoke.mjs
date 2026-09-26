// 実 VS Code の Webview から、模擬モデルと実 App Server による承認・停止を検証する。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";

const root = process.cwd();
const output = path.join(root, "dist/vscode-sandbox-smoke");
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, "run-"));
const userData = path.join(fixture, "profile");
const cwd = path.join(fixture, "workspace");
const agentDir = path.join(fixture, "agent");
await Promise.all([
	mkdir(path.join(userData, "User"), { recursive: true }),
	mkdir(cwd),
	mkdir(agentDir),
]);
const report = {
	date: new Date().toISOString(),
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	cases: [],
	errors: [],
};
const server = createServer(async (request, response) => {
	try {
		let body = "";
		for await (const chunk of request) {
			body += chunk;
		}
		const input = JSON.parse(body);
		response.writeHead(200, { "content-type": "text/event-stream" });
		const send = (delta, finish = null) =>
			response.write(
				`data: ${JSON.stringify({ id: "ui-smoke", object: "chat.completion.chunk", created: 1, model: "smoke", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
			);
		send({ role: "assistant" });
		if (input.messages.at(-1)?.role === "tool") {
			send({ content: "UI_SMOKE_COMPLETE" });
			send({}, "stop");
		} else {
			const latest = input.messages.findLast(
				(message) => message.role === "user",
			);
			const prompt = JSON.stringify(latest.content);
			const kind =
				["stop", "deny", "revoked"].find((value) =>
					prompt.includes(value),
				) ?? "allow";
			const command =
				kind === "stop"
					? "Set-Content -LiteralPath started.txt -Value started; Start-Sleep -Seconds 30; Set-Content -LiteralPath unexpected.txt -Value bad"
					: `Set-Content -LiteralPath ${kind}.txt -Value executed; Write-Output '日本語 UI_SHELL_OK'`;
			send({
				tool_calls: [
					{
						index: 0,
						id: `call-${Date.now()}`,
						type: "function",
						function: {
							name: "powershell",
							arguments: JSON.stringify({ command, timeout: 60 }),
						},
					},
				],
			});
			send({}, "tool_calls");
		}
		response.end("data: [DONE]\n\n");
	} catch (error) {
		report.errors.push(String(error));
		response.destroy();
	}
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await writeFile(
	path.join(agentDir, "models.json"),
	JSON.stringify({
		providers: {
			local: {
				baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
				api: "openai-completions",
				apiKey: "local-test-only",
				models: [
					{
						id: "smoke",
						reasoning: false,
						input: ["text"],
						contextWindow: 8192,
						maxTokens: 128,
					},
				],
			},
		},
	}),
);
await writeFile(
	path.join(agentDir, "settings.json"),
	JSON.stringify({ defaultProvider: "local", defaultModel: "smoke" }),
);
await writeFile(
	path.join(userData, "User/settings.json"),
	JSON.stringify({
		"nerita.backend": "pi",
		"security.workspace.trust.enabled": false,
		"workbench.startupEditor": "none",
		"window.restoreWindows": "none",
		"window.dialogStyle": "custom",
		"git.enabled": false,
	}),
);
let app;
try {
	app = await electron.launch({
		executablePath:
			process.env.VSCODE_EXECUTABLE ??
			path.join(
				process.env.LOCALAPPDATA,
				"Programs/Microsoft VS Code/Code.exe",
			),
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		args: [
			`--user-data-dir=${userData}`,
			`--extensions-dir=${path.join(fixture, "extensions")}`,
			`--extensionDevelopmentPath=${root}`,
			"--disable-extensions",
			"--skip-welcome",
			"--skip-release-notes",
			cwd,
		],
		timeout: 30_000,
	});
	const page = await app.firstWindow();
	page.on("pageerror", (error) => report.errors.push(error.message));
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			message.location().url.startsWith("vscode-webview:")
		) {
			report.errors.push(message.text());
		}
	});
	page.setDefaultTimeout(30_000);
	await page.locator(".monaco-workbench").waitFor();
	// 起動時のレイアウト完了を待ち、コマンドパレットから製品ビューを開く。
	await expect(async () => {
		await page.keyboard.press("F1");
		await expect(page.locator(".quick-input-widget input")).toBeVisible({
			timeout: 1000,
		});
	}).toPass({ timeout: 15_000 });
	await page
		.locator(".quick-input-widget input")
		.fill(">Nerita for Codex: チャットを開く");
	await expect(page.locator(".quick-input-list")).toContainText(
		"Nerita for Codex: チャットを開く",
	);
	await page.keyboard.press("Enter");
	let frame;
	await expect(async () => {
		for (const candidate of page.frames()) {
			if (
				await candidate
					.getByRole("textbox", { name: "Codexへのメッセージ" })
					.count()
			) {
				frame = candidate;
			}
		}
		assert.ok(frame);
	}).toPass({ timeout: 30_000 });
	await expect(frame.getByRole("textbox")).toBeVisible();
	// 通知が入力欄を覆わないよう、実際の VS Code コマンドで閉じる。
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">Notifications: Hide Notifications");
	await page.keyboard.press("Enter");
	await expect(
		frame.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Nerita Trust 0/1", { exact: true }),
	).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "trust-restricted.png") });
	await page.getByText("Nerita Trust 0/1", { exact: true }).click();
	await expect(page.locator(".quick-input-list")).toContainText(
		"取得したrepoを選択",
	);
	await page.locator(".quick-input-widget input").fill(cwd);
	await page.keyboard.press("Enter");
	await expect(
		page.locator(".quick-input-list").getByText("Trust", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("このコードを信頼しますか？", { exact: false }),
	).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "trust-confirm.png") });
	await page
		.getByRole("button", { name: "Trust this root", exact: true })
		.click();
	await expect(
		page.getByText("Nerita Trust 1/1", { exact: true }),
	).toBeVisible();
	report.cases.push({ id: "human-trust", status: "pass" });
	await frame
		.getByRole("button", { name: "未接続：接続する", exact: true })
		.click();
	await expect(
		frame.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	for (const kind of ["allow", "deny", "stop"]) {
		await frame.getByRole("textbox").fill(kind);
		await frame.getByRole("button", { name: "送信", exact: true }).click();
		const approval = frame.getByRole("region", { name: "承認要求" });
		await expect(approval).toContainText("Shell Sandbox", {
			timeout: 30_000,
		});
		await approval.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(fixture, `${kind}-pending.png`),
		});
		await approval
			.getByRole("button", {
				name: kind === "deny" ? "拒否" : "今回のみ許可",
				exact: true,
			})
			.click();
		if (kind === "stop") {
			await expect(async () =>
				assert.match(
					await readFile(path.join(cwd, "started.txt"), "utf8"),
					/started/,
				),
			).toPass({ timeout: 15_000 });
			await frame
				.getByRole("button", { name: "停止", exact: true })
				.click();
			await expect(
				frame.getByText("停止しました", { exact: true }),
			).toBeVisible();
			await assert.rejects(readFile(path.join(cwd, "unexpected.txt")), {
				code: "ENOENT",
			});
		} else {
			await expect(
				frame.getByRole("button", { name: "停止", exact: true }),
			).toHaveCount(0, { timeout: 30_000 });
		}
		if (kind === "allow") {
			assert.match(
				await readFile(path.join(cwd, "allow.txt"), "utf8"),
				/executed/,
			);
			await frame
				.locator(".tool-card")
				.last()
				.getByRole("button", { expanded: false })
				.click();
			await expect(frame.locator(".tool-card").last()).toContainText(
				"日本語 UI_SHELL_OK",
			);
		}
		if (kind === "deny") {
			await assert.rejects(readFile(path.join(cwd, "deny.txt")), {
				code: "ENOENT",
			});
		}
		await page.screenshot({
			path: path.join(fixture, `${kind}-resolved.png`),
		});
		report.cases.push({ id: kind, status: "pass" });
	}
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">Developer: Reload Window");
	await expect(page.locator(".quick-input-list")).toContainText(
		"Developer: Reload Window",
	);
	await page.keyboard.press("Enter");
	await expect(async () => {
		const candidate = page
			.frames()
			.find((item) => item !== frame && item.url().includes("fake.html"));
		assert.ok(candidate);
		await expect(candidate.getByRole("textbox")).toBeVisible({
			timeout: 1000,
		});
		frame = candidate;
	}).toPass({ timeout: 30_000 });
	await expect(
		frame.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible({ timeout: 30_000 });
	await frame.getByRole("textbox").fill("allow-after-reload");
	await frame.getByRole("button", { name: "送信", exact: true }).click();
	await frame
		.getByRole("region", { name: "承認要求" })
		.getByRole("button", { name: "今回のみ許可", exact: true })
		.click();
	await expect(
		frame.getByRole("button", { name: "停止", exact: true }),
	).toHaveCount(0, { timeout: 30_000 });
	await expect(
		frame.locator('.tool-card[data-status="completed"]').last(),
	).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "reconnected.png") });
	report.cases.push({ id: "window-reload-reconnect", status: "pass" });
	await page.getByText("Nerita Trust 1/1", { exact: true }).click();
	await expect(page.locator(".quick-input-list")).toContainText(
		"取得したrepoを選択",
	);
	await page.locator(".quick-input-widget input").fill(cwd);
	await page.keyboard.press("Enter");
	await expect(
		page
			.locator(".quick-input-list")
			.getByText("Revoke Trust", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("Nerita Trust 0/1", { exact: true }),
	).toBeVisible();
	await frame
		.getByRole("button", { name: "未接続：接続する", exact: true })
		.click();
	await expect(
		frame.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	await frame.getByRole("textbox").fill("revoked");
	await frame.getByRole("button", { name: "送信", exact: true }).click();
	await expect(
		frame.locator('.tool-card[data-status="failed"]').last(),
	).toBeVisible();
	await expect(frame.getByRole("region", { name: "承認要求" })).toHaveCount(
		0,
	);
	await assert.rejects(readFile(path.join(cwd, "revoked.txt")), {
		code: "ENOENT",
	});
	await page.screenshot({ path: path.join(fixture, "trust-revoked.png") });
	report.cases.push({ id: "revoke-denies-without-approval", status: "pass" });
	assert.deepEqual(report.errors, []);
} catch (error) {
	const failedPage = app?.windows()[0];
	if (failedPage) {
		await failedPage.screenshot({
			path: path.join(fixture, "failure.png"),
		});
		console.log(await failedPage.locator("body").innerText());
		console.log(failedPage.frames().map((item) => item.url()));
	}
	report.cases.push({
		id: "ui",
		status: "fail",
		error: String(error).replaceAll(fixture, "<fixture>"),
	});
	process.exitCode = 1;
} finally {
	await app?.close();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	report.artifacts = path.relative(root, fixture).replaceAll("\\", "/");
	await writeFile(
		path.join(output, "results.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
}
