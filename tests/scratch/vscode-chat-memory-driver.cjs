// 配布物のセッション復元と新しいチャットを実際の Webview で繰り返す。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const vscode = require("vscode");
const { rendererMapping, sample } = require("./vscode-memory-metrics.cjs");
const { connectWebview } = require("./vscode-memory-cdp.cjs");
const { observeRpc } = require("./vscode-memory-rpc.cjs");

/** CDP はワークベンチではなくチャットの OOPIF に接続する。 */
async function connect() {
	await vscode.extensions.getExtension("nerita-local.nerita").activate();
	await vscode.commands.executeCommand("nerita.codex.openChat");
	const port = (
		await fs.readFile(
			path.join(process.env.NERITA_UI_PROFILE, "DevToolsActivePort"),
			"utf8",
		)
	).split("\n")[0];
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const pages = browser.contexts()[0].pages();
	const page = pages.find((entry) => entry.url().includes("workbench"));
	const browserSession = await browser.newBrowserCDPSession();
	try {
		const { chat, frameSession } = await connectWebview(browserSession);
		await expect
			.poll(
				() =>
					chat.evaluate(
						() =>
							globalThis.document.querySelector(
								"[data-connection]",
							)?.dataset.connection,
					),
				{ timeout: 30000 },
			)
			.toBe("ready");
		const mapping = await rendererMapping(
			browserSession,
			frameSession,
			chat,
		);
		assert.ok(
			mapping.rendererPid,
			`Webview のプロセスを特定できません: ${JSON.stringify(mapping)}`,
		);
		return {
			browser,
			page,
			chat,
			frameSession,
			browserSession,
			...mapping,
		};
	} catch (error) {
		await page.screenshot({
			path: path.join(process.env.NERITA_UI_ARTIFACTS, "failed.png"),
		});
		await browser.close();
		throw error;
	}
}

/** 表示が安定してから、通常操作でのメモリ使用量と GC 後の値を採取する。 */
async function measure(context, results, label) {
	await context.page.waitForTimeout(3000);
	results.samples.push(await sample(context, label, false));
	if (results.mode === "controlled") {
		results.samples.push(await sample(context, label, true));
	}
	await context.page.screenshot({
		path: path.join(process.env.NERITA_UI_ARTIFACTS, `${label}.png`),
	});
	await fs.writeFile(
		path.join(process.env.NERITA_UI_ARTIFACTS, "results.json"),
		JSON.stringify(results, null, 2),
	);
	console.log("Measured", label);
}

/** 指定された UI ボタンの有効化を待ち、通常のクリックハンドラーを実行する。 */
async function clickButton(chat, label) {
	await clickSelector(chat, `button[aria-label="${label}"]`);
}

/** 一覧の再取得による DOM の入れ替えを考慮し、存在確認とクリックをまとめる。 */
async function clickSelector(chat, selector) {
	await expect
		.poll(
			() =>
				chat.evaluate((value) => {
					const button = globalThis.document.querySelector(value);
					if (!button || button.disabled) {
						return false;
					}
					button.click();
					return true;
				}, selector),
			{ timeout: 30000 },
		)
		.toBe(true);
}

/** 復元した会話の件数が揃うまで待ち、描画途中のメモリを結果にしない。 */
async function waitForCount(chat, selector, count) {
	await expect
		.poll(
			() =>
				chat.evaluate(
					(value) =>
						globalThis.document.querySelectorAll(value).length,
					selector,
				),
			{ timeout: 60000 },
		)
		.toBe(count);
}

/** 履歴を一覧から開き、同じ操作経路でチャットをクリアする。 */
async function cycle(context, results, index) {
	const { chat } = context;
	await clickButton(chat, "セッション一覧");
	await waitForCount(chat, 'button[aria-label$="を開く"]', 1);
	await clickSelector(chat, 'button[aria-label$="を開く"]');
	await expect
		.poll(
			() =>
				chat.evaluate(() =>
					Number(
						globalThis.document.querySelector("[data-entry-count]")
							?.dataset.entryCount,
					),
				),
			{ timeout: 60000 },
		)
		.toBe(743);
	await waitForCount(chat, '[data-entry-key][data-index="742"]', 1);
	const mounted = await chat.evaluate(
		() => globalThis.document.querySelectorAll("[data-entry-key]").length,
	);
	assert.ok(
		mounted > 0 && mounted < 50,
		`描画範囲が制限されていません: ${mounted}`,
	);
	if (
		await chat.evaluate(() =>
			Boolean(
				globalThis.document.querySelector(
					'button[aria-label="セッション一覧を閉じる"]',
				),
			),
		)
	) {
		await clickButton(chat, "セッション一覧を閉じる");
	}
	await measure(context, results, `loaded-${index}`);
	await clickButton(chat, "新しいチャット");
	await waitForCount(chat, ".message", 0);
	await waitForCount(chat, ".tool-card", 0);
	await measure(context, results, `cleared-${index}`);
}

/** 計測結果を保存し、専用 VS Code は外側の検証ドライバーから終了させる。 */
async function run() {
	let context;
	const results = {
		vscodeVersion: vscode.version,
		history: JSON.parse(process.env.NERITA_MEMORY_HISTORY),
		samples: [],
		errors: [],
		diagnostics: [],
		mode: process.env.NERITA_MEMORY_MODE,
	};
	const stopObserving = observeRpc(results.diagnostics);
	try {
		context = await connect();
		results.rendererMapping = {
			rendererPid: context.rendererPid,
			frameId: context.frameId,
			frames: context.frames,
			marker: context.marker,
		};
		context.frameSession.on("Runtime.exceptionThrown", (event) =>
			results.errors.push(JSON.stringify(event.exceptionDetails)),
		);
		await measure(context, results, "baseline");
		for (let index = 1; index <= 3; index++) {
			await cycle(context, results, index);
		}
		if (results.mode === "natural") {
			await context.page.waitForTimeout(15000);
			await measure(context, results, "settled");
			results.samples.push(await sample(context, "settled", true));
		}
		assert.deepEqual(results.errors, []);
	} finally {
		stopObserving();
		await fs.writeFile(
			path.join(process.env.NERITA_UI_ARTIFACTS, "results.json"),
			JSON.stringify(results, null, 2),
		);
		await context?.browser.close();
	}
}

module.exports = { run };
