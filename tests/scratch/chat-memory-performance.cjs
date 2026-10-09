// Storybook 起動後、`node tests/scratch/chat-memory-performance.cjs <JSONL> <ラベル>` で履歴表示中とクリア後のメモリを比較する。
// 同梱 App Server で履歴の複製を復元する。本文を含む一時領域は削除し、計測値と UI 画像だけを残す。
const { chromium, expect } = require("@playwright/test");
const { createReadStream } = require("node:fs");
const { mkdir, writeFile, mkdtemp, copyFile, rm } = require("node:fs/promises");
const { createInterface } = require("node:readline");
const { join, basename, resolve, sep } = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

/** 元の履歴と設定を変更せず、コピーだけを製品の復元処理へ渡す。 */
async function history(file) {
	const root = await mkdtemp(join("dist", "chat-memory-source-"));
	let rpc;
	try {
		const { metadata, api } = await prepareHistory(file, root);
		rpc = historyRpc(root);
		return await restoreHistory(api, rpc, root, metadata.payload.id);
	} finally {
		await rpc?.dispose();
		await removeHistoryWorkspace(root);
	}
}

/** JSONL の保存日と ID を読み、独立した `CODEX_HOME` と製品コードのバンドルを用意する。 */
async function prepareHistory(file, root) {
	let metadata;
	for await (const line of createInterface({
		input: createReadStream(file),
		crlfDelay: Infinity,
	})) {
		metadata = JSON.parse(line);
		break;
	}
	const directory = join(
		root,
		"sessions",
		...metadata.timestamp.slice(0, 10).split("-"),
	);
	await mkdir(directory, { recursive: true });
	await copyFile(file, join(directory, basename(file)));
	const bundle = join(root, "history.cjs");
	await require("esbuild").build({
		stdin: {
			contents:
				'export { restoreDisplayHistory } from "./apps/vscode-nerita/src/extension/backends/codex/history/restoreHistory"; export { parseReadThread, parseTurns, parseItems } from "./apps/vscode-nerita/src/extension/backends/codex/protocol/history";',
			resolveDir: process.cwd(),
			loader: "ts",
		},
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	return { metadata, api: require(resolve(bundle)) };
}

/** 復元専用接続に限定し、タイムアウトや終了時には待機要求と子プロセスを解放する。 */
function historyRpc(root) {
	const executable = resolve(
		"apps/vscode-nerita/dist/runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	);
	const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
		env: { ...process.env, CODEX_HOME: resolve(root) },
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stderr.resume();
	const pending = new Map();
	let nextId = 0;
	const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
	const fail = (error) => {
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		pending.clear();
	};
	child.on("error", fail);
	child.on("exit", () => fail(new Error("App Server exited")));
	lines.on("line", (line) => {
		const response = JSON.parse(line);
		const request = pending.get(response.id);
		if (!request) {
			return;
		}
		pending.delete(response.id);
		clearTimeout(request.timer);
		if (response.error) {
			request.reject(new Error(JSON.stringify(response.error)));
		} else {
			request.resolve(response.result);
		}
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timeout: ${method}`));
			}, 30000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	const dispose = async () => {
		fail(new Error("App Server disposed"));
		lines.close();
		if (child.pid && child.exitCode === null && child.signalCode === null) {
			const exited = new Promise((resolve) =>
				child.once("exit", resolve),
			);
			child.kill();
			await exited;
		}
	};
	return {
		request,
		dispose,
		notify: (method) =>
			child.stdin.write(`${JSON.stringify({ method })}\n`),
	};
}

/** App Server の項目を実際の履歴復元・出力退避処理で表示状態へ変換する。 */
async function restoreHistory(api, rpc, root, threadId) {
	const { request, notify } = rpc;
	await request("initialize", {
		clientInfo: { name: "nerita_memory_measurement", version: "0.0.1" },
		capabilities: { experimentalApi: true },
	});
	notify("initialized");
	const { thread } = api.parseReadThread(
		await request("thread/resume", {
			threadId,
			cwd: resolve(root),
			excludeTurns: false,
		}),
	);
	const client = {
		listTurns: async (threadId, cursor, itemsView) =>
			api.parseTurns(
				await request("thread/turns/list", {
					threadId,
					cursor,
					itemsView,
					sortDirection: "asc",
					limit: 50,
				}),
			),
		listItems: async (threadId, turnId, cursor) =>
			api.parseItems(
				await request("thread/items/list", {
					threadId,
					turnId,
					cursor,
					sortDirection: "asc",
					limit: 100,
				}),
			),
	};
	const display = await api.restoreDisplayHistory(
		client,
		thread,
		() => true,
		true,
	);
	try {
		const counts = {};
		for (const tool of display.state.tools) {
			counts[tool.kind] = (counts[tool.kind] ?? 0) + 1;
		}
		expect(display.state.messages.length).toBeGreaterThan(0);
		return { ...display.state, counts };
	} finally {
		display.outputs.dispose();
	}
}

/** 自分で作った dist 内の一時領域だけを削除する。 */
async function removeHistoryWorkspace(root) {
	if (!resolve(root).startsWith(resolve("dist") + sep)) {
		throw new Error("Unexpected temporary directory");
	}
	await rm(root, {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 200,
	});
}

/** GC 後の JS ヒープ・DOM 数と、Windows 上の描画プロセス全体を同じ条件で測る。 */
async function memory(cdp, browserCdp) {
	await cdp.send("HeapProfiler.collectGarbage");
	const heap = await cdp.send("Runtime.getHeapUsage");
	const dom = await cdp.send("Memory.getDOMCounters");
	const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
	const ids = processInfo
		.filter((process) => process.type === "renderer")
		.map((process) => process.id);
	const processMemory = JSON.parse(
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				`Get-Process -Id ${ids.join(",")} | Select-Object Id, PrivateMemorySize64, WorkingSet64 | ConvertTo-Json -Compress`,
			],
			{ encoding: "utf8", windowsHide: true },
		),
	);
	const renderers = Array.isArray(processMemory)
		? processMemory
		: [processMemory];
	return {
		heapMiB: heap.usedSize / 1048576,
		backingStorageMiB: (heap.backingStorageSize ?? 0) / 1048576,
		rendererPrivateMiB:
			renderers.reduce(
				(sum, process) => sum + process.PrivateMemorySize64,
				0,
			) / 1048576,
		rendererWorkingSetMiB:
			renderers.reduce((sum, process) => sum + process.WorkingSet64, 0) /
			1048576,
		...dom,
	};
}

/** 実際の履歴全体と発言だけを別ページで測り、閉じたツール本文の寄与を分ける。 */
async function measure(browser, data, theme, mode, directory) {
	const page = await browser.newPage({
		viewport: { width: 420, height: 720 },
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-app--empty&viewMode=story&globals=theme:${theme}`,
		);
		await expect(page.getByRole("textbox")).toBeVisible({ timeout: 30000 });
		await page.evaluate(() => globalThis.document.fonts.ready);
		const cdp = await page.context().newCDPSession(page);
		const browserCdp = await browser.newBrowserCDPSession();
		const baseline = await memory(cdp, browserCdp);
		await page.evaluate(
			({ messages, tools }) => {
				globalThis.document
					.querySelector("[data-story-chat]")
					.storyBridge.patchState({
						messages,
						tools,
						run: "completed",
					});
			},
			{
				messages: data.messages,
				tools: mode === "full" ? data.tools : [],
			},
		);
		await expect(page.locator(".message")).toHaveCount(
			data.messages.length,
			{ timeout: 120000 },
		);
		await page.evaluate(
			() => new Promise(globalThis.requestAnimationFrame),
		);
		const loaded = await memory(cdp, browserCdp);
		await page.screenshot({
			path: join(directory, `${theme}-${mode}-bottom.png`),
		});
		await page
			.getByRole("region", { name: "会話", exact: true })
			.evaluate((element) => {
				element.scrollTop = 0;
			});
		await page.screenshot({
			path: join(directory, `${theme}-${mode}-top.png`),
		});
		await page.evaluate(() => {
			globalThis.document
				.querySelector("[data-story-chat]")
				.storyBridge.patchState({
					messages: [],
					tools: [],
					run: "idle",
				});
		});
		await expect(page.locator(".message")).toHaveCount(0);
		const cleared = await memory(cdp, browserCdp);
		await cdp.detach();
		await browserCdp.detach();
		expect(errors).toEqual([]);
		return { theme, mode, baseline, loaded, cleared, errors };
	} catch (error) {
		await page.screenshot({
			path: join(directory, `${theme}-${mode}-failure.png`),
		});
		console.error(JSON.stringify({ errors }));
		throw error;
	} finally {
		await page.close();
	}
}

/** 結果と画像だけを実行ごとのディレクトリへ保存する。 */
async function main() {
	const data = await history(process.argv[2]);
	const directory = join(
		"dist/ui-review",
		`chat-memory-${process.argv[3] ?? "measurement"}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	try {
		const results = [];
		for (const theme of ["dark2026", "light"]) {
			for (const mode of ["messages", "full"]) {
				const result = await measure(
					browser,
					data,
					theme,
					mode,
					directory,
				);
				results.push(result);
				console.log(JSON.stringify(result));
			}
		}
		const result = {
			directory,
			counts: data.counts,
			messages: data.messages.length,
			tools: data.tools.length,
			messageBytes: Buffer.byteLength(JSON.stringify(data.messages)),
			toolBytes: Buffer.byteLength(JSON.stringify(data.tools)),
			results,
		};
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
