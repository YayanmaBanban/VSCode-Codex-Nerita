// 配布用モバイル画面を Chrome の 320px 表示で操作する。
const { test, expect } = require("@playwright/test");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

const contentTypes = new Map([
	["/", ["index.html", "text/html"]],
	["/index.css", ["index.css", "text/css"]],
	["/index.js", ["index.js", "text/javascript"]],
]);

/** Vite が生成した静的資産を製品と同じ Content-Type で読み込む。 */
async function readAssets() {
	const assets = new Map();
	for (const [route, [file, type]] of contentTypes) {
		const body = await readFile(
			join(__dirname, "../../dist/remote-ui", file),
		);
		assets.set(route, { type, body });
	}
	return assets;
}

/** 明示的な API 応答と実際の SSE ソケットで、ブラウザー側の挙動を検証する。 */
async function mobileFixture() {
	const assets = await readAssets();
	const clients = new Set();
	const state = {
		backend: "pi",
		backendGeneration: 0,
		revision: 0,
		connectionGeneration: randomUUID(),
		availableBackends: [
			{ id: "pi", selectable: true },
			{ id: "codex", selectable: true },
		],
		switching: false,
		connection: "ready",
		sessionId: "fixture-session",
		sessionTitle: "検証用チャット",
		runId: null,
		run: "idle",
		messages: [],
		tools: [],
		pendingApprovals: [],
		error: null,
		capabilities: { send: true, stop: false, approve: true },
		truncated: false,
		canManageSessions: true,
		sessions: [{ id: "previous-session", title: "以前の会話" }],
	};
	const server = createServer(createRouter(assets, state, clients));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		drop: () => {
			for (const client of clients) {
				client.destroy();
			}
		},
		close: () => {
			server.close();
			server.closeAllConnections();
		},
	};
}

/** API の認証遷移と配信だけを模擬し、変更後の状態を全量で送る。 */
function createRouter(assets, state, clients) {
	let paired = false;
	return (request, response) => {
		const asset = assets.get(request.url);
		if (asset) {
			response.writeHead(200, {
				"Content-Type": asset.type,
				"Content-Security-Policy":
					"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'",
			});
			response.end(asset.body);
			return;
		}
		switch (request.url) {
			case "/api/v1/bootstrap":
				if (paired) {
					reply(response, { csrf: "a".repeat(64), state });
				} else {
					response.writeHead(401).end("{}");
				}
				break;
			case "/api/v1/pair":
				paired = true;
				reply(response, { ok: true });
				break;
			case "/api/v1/events":
				response.writeHead(200, {
					"Content-Type": "text/event-stream",
				});
				clients.add(response);
				response.on("close", () => clients.delete(response));
				publish(response, state);
				break;
			case "/api/v1/workspace":
				void serveWorkspacePreview(request, response);
				break;
			case "/api/v1/actions":
				void applyAction(request, response, state, clients);
				break;
			case "/api/v1/logout":
				paired = false;
				reply(response, { ok: true });
				break;
			default:
				response.writeHead(204).end();
		}
	};
}

/** 配布したブラウザー画面の一覧とプレビューを、同じ HTTP 境界から返す。 */
async function serveWorkspacePreview(request, response) {
	const operation = await require("node:stream/consumers").json(request);
	if (operation.type === "read") {
		reply(response, {
			type: "file",
			path: operation.path,
			text: "閲覧専用の内容",
		});
		return;
	}
	reply(response, {
		type: "list",
		files: [{ path: "preview.txt", status: " M", canStage: true }],
		push: null,
		index: null,
	});
}

/** 操作後の状態をクライアントすべてに配信する。 */
async function applyAction(request, response, state, clients) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(chunk);
	}
	const action = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (action.type === "prompt.send") {
		state.messages.push({
			id: action.requestId,
			role: "user",
			text: action.text,
			streaming: false,
		});
		state.runId = "fixture-run";
		state.run = "running";
		state.pendingApprovals = [
			{
				id: "fixture-permission",
				title: "ファイル変更の承認",
				options: [
					{ id: "accept", kind: "allow" },
					{ id: "decline", kind: "deny" },
				],
			},
		];
		state.capabilities = { send: false, stop: true, approve: true };
		for (const option of state.availableBackends) {
			option.selectable = false;
		}
	}
	if (action.type === "approval.respond") {
		state.pendingApprovals = [];
	}
	if (action.type === "run.stop") {
		state.run = "cancelled";
		state.capabilities = { send: true, stop: false, approve: true };
		for (const option of state.availableBackends) {
			option.selectable = true;
		}
	}
	if (action.type === "backend.select") {
		state.backend = action.backend;
		state.backendGeneration++;
		state.sessionId = "next-session";
		state.messages = [];
	}
	if (action.type === "session.load") {
		state.sessionId = action.sessionId;
		state.sessionTitle = "以前の会話";
	}
	state.revision++;
	reply(response, { ok: true, requestId: action.requestId });
	for (const client of clients) {
		publish(client, state);
	}
}

/** JSON API の応答形式を再現する。 */
function reply(response, body) {
	response
		.writeHead(200, { "Content-Type": "application/json" })
		.end(JSON.stringify(body));
}

/** 初回再接続を短くして、再接続前後の表示を確認する。 */
function publish(response, state) {
	response.write(
		`retry: 300\nevent: state\ndata: ${JSON.stringify(state)}\n\n`,
	);
}

/** タッチ幅を保ち、メッセージが画面を横に押し広げないことを確認する。 */
async function checkWidth(page) {
	const dimensions = await page.locator("html").evaluate((root) => ({
		width: root.clientWidth,
		content: root.scrollWidth,
		minButton: Math.min(
			...[...root.querySelectorAll("button")].map((button) => {
				const { width, height } = button.getBoundingClientRect();
				return Math.min(width, height);
			}),
		),
	}));
	expect(dimensions.content).toBe(dimensions.width);
	expect(dimensions.minButton).toBeGreaterThanOrEqual(44);
}

/** 操作と画像取得を同じ実行の状態で行う。 */
async function verifyConversation(page, fixture, testInfo, colorScheme) {
	const message = `<strong>${"連続した文字".repeat(80)}</strong>`;
	const input = page.getByRole("textbox", { name: "メッセージ" });
	await expect(input).toBeVisible();
	await input.fill(message);
	await page.getByRole("button", { name: "送信" }).click();
	await expect(page.getByText(message, { exact: true })).toBeVisible();
	await openBackends(page);
	await expect(
		page.getByRole("menuitemradio", { name: "Codex" }),
	).toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("heading", { name: "ファイル変更の承認" }),
	).toBeVisible();
	await page.locator("header").scrollIntoViewIfNeeded();
	await expect(
		page.getByRole("button", { name: "停止", exact: true }),
	).toBeInViewport();
	await checkWidth(page);
	await page.screenshot({
		path: testInfo.outputPath(`${colorScheme}-chat.png`),
		fullPage: true,
	});
	fixture.drop();
	await expect(
		page.getByRole("button", { name: "停止", exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "停止", exact: true }),
	).toBeEnabled();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "今回だけ許可" }).click();
	await expect(page.getByText("今回だけ許可しました。")).toBeVisible();
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await expect(page.getByText("停止済み", { exact: true })).toBeVisible();
	page.once("dialog", (dialog) => dialog.accept());
	await openBackends(page);
	await page.getByRole("menuitemradio", { name: "Codex" }).click();
	await openBackends(page);
	await expect(
		page.getByRole("menuitemradio", { name: "Codex" }),
	).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(page.getByText(message, { exact: true })).toHaveCount(0);
	await page.reload();
	await openBackends(page);
	await expect(
		page.getByRole("menuitemradio", { name: "Codex" }),
	).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "オプション" }).click();
	const menu = page.getByRole("menu");
	await expectThemeColor(
		menu,
		"background-color",
		"--nerita-dropdown-background",
	);
	const backend = page.getByRole("menuitem", { name: "バックエンド" });
	const disconnect = page.getByRole("menuitem", { name: "接続解除" });
	await expect(disconnect).toHaveCSS("align-items", "center");
	await expect(disconnect).toHaveCSS("gap", "8px");
	await expect(disconnect).toHaveCSS("font-size", "12px");
	const backendIcon = await backend.locator("svg").first().boundingBox();
	const disconnectIcon = await disconnect.locator("svg").boundingBox();
	expect(disconnectIcon.x).toBe(backendIcon.x);
	expect(disconnectIcon.width).toBe(backendIcon.width);
	await disconnect.click();
	await expect(
		page.getByRole("heading", { name: "リモートアクセス" }),
	).toBeVisible();
}

/** 共通ヘッダーのオプションから、現在のバックエンドメニューを開く。 */
async function openBackends(page) {
	await page.getByRole("button", { name: "オプション" }).click();
	await page.getByRole("menuitem", { name: "バックエンド" }).focus();
	await page.keyboard.press("ArrowRight");
}

/** 幅によって切り替わる配置と、入力欄の高さを確認する。 */
async function verifyFileLayout(page) {
	const openSidebar = page.getByRole("button", { name: "サイドバーを開く" });
	const chat = page.getByRole("main");
	await expect(openSidebar).toHaveText("");
	await expect(openSidebar).toHaveCSS("border-top-width", "0px");
	const rail = await openSidebar.boundingBox();
	const initialChat = await chat.boundingBox();
	expect(rail.x).toBeLessThan(initialChat.x);
	const drawer = page.getByRole("dialog", { name: "サイドバー" });
	await openSidebar.click();
	await expect(drawer).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(openSidebar).toBeFocused();
	await openSidebar.click();
	await drawer.getByRole("button", { name: /preview\.txt$/u }).click();
	await expect(drawer).toHaveCount(0);
	const file = page.getByRole("region", { name: "ファイル内容" });
	await expect(file.getByText("閲覧専用の内容")).toBeVisible();
	const narrow = await file.boundingBox();
	const narrowChat = await chat.boundingBox();
	expect(narrow.y).toBeLessThan(narrowChat.y);
	await page.setViewportSize({ width: 1100, height: 740 });
	const sidebar = page.getByRole("complementary", { name: "サイドバー" });
	await expect(sidebar.getByText("変更ファイル")).toBeVisible();
	const root = page.locator(".remote-page");
	await expectThemeColor(
		root,
		"background-color",
		"--nerita-editor-background",
	);
	await expectThemeColor(
		sidebar,
		"background-color",
		"--nerita-side-bar-background",
	);
	const wide = await file.boundingBox();
	const wideChat = await chat.boundingBox();
	expect(wide.x + wide.width).toBeLessThan(wideChat.x);
	await file.getByRole("button", { name: "チャットを全体に表示" }).click();
	await expect(file).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "メッセージ" })).toHaveCSS(
		"resize",
		"none",
	);
	await page.setViewportSize({ width: 320, height: 640 });
}

/** テーマのフォールバックも含めて、表示色と共通トークンの解決結果を比較する。 */
async function expectThemeColor(locator, property, token) {
	const expected = await locator.evaluate(
		(element, { property, token }) => {
			const probe = element.ownerDocument.createElement("span");
			probe.style.setProperty(property, `var(${token})`);
			element.append(probe);
			const color = element.ownerDocument.defaultView
				.getComputedStyle(probe)
				.getPropertyValue(property);
			probe.remove();
			return color;
		},
		{ property, token },
	);
	await expect(locator).toHaveCSS(property, expected);
}

/** 履歴をファイルのサイドバーとは別に開き、復元後の会話に戻る。 */
async function verifySessionPanel(page) {
	const toggle = page.getByRole("button", {
		name: "セッション一覧",
		exact: true,
	});
	const panel = page.getByRole("complementary", {
		name: "セッション一覧",
		exact: true,
	});
	const drawer = page.getByRole("dialog", { name: "サイドバー" });
	await toggle.click();
	await expect(panel).toBeVisible();
	await expect(drawer).toHaveCount(0);
	await expect(
		panel.getByRole("button", { name: "セッション一覧を閉じる" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(toggle).toBeFocused();
	await page.setViewportSize({ width: 1100, height: 740 });
	await toggle.click();
	await expect(panel).toBeVisible();
	const sidebar = page.getByRole("complementary", { name: "サイドバー" });
	await expect(
		sidebar.getByRole("heading", { name: "変更ファイル" }),
	).toBeVisible();
	const panelBounds = await panel.boundingBox();
	const chatBounds = await page.getByRole("main").boundingBox();
	expect(panelBounds.x).toBeGreaterThan(chatBounds.x);
	await page.setViewportSize({ width: 320, height: 640 });
	await panel.getByRole("button", { name: "以前の会話を開く" }).click();
	await expect(panel).toHaveCount(0);
	await expect(toggle).toBeFocused();
	await expect(
		page.getByRole("heading", { level: 1, name: "以前の会話" }),
	).toBeVisible();
}

for (const colorScheme of ["light", "dark"]) {
	test(`320px のペアリングとチャット ${colorScheme}`, async ({
		browser,
	}, testInfo) => {
		const fixture = await mobileFixture();
		const page = await browser.newPage({
			viewport: { width: 320, height: 640 },
			hasTouch: true,
			colorScheme,
		});
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		try {
			await page.goto(fixture.url);
			await page.getByLabel("8桁のペアリングコード").fill("00123456");
			await checkWidth(page);
			await page.screenshot({
				path: testInfo.outputPath(`${colorScheme}-pair.png`),
				fullPage: true,
			});
			await page.getByRole("button", { name: "接続する" }).click();
			await verifyFileLayout(page);
			await verifySessionPanel(page);
			await verifyConversation(page, fixture, testInfo, colorScheme);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
			fixture.close();
		}
	});
}
