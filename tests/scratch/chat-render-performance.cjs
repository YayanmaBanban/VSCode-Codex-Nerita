// Storybook 起動後、`node tests/scratch/chat-render-performance.cjs <JSONL> <ラベル>` で実履歴の入力・応答描画を比較する。
// 履歴は通信境界へ注入し、製品の Markdown と入力欄を Chromium 上でそのまま動かす。
const { chromium, expect } = require("@playwright/test");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 個人の履歴本文はソースへ保存せず、指定したファイルから表示用の発言だけを取り出す。 */
async function history(file) {
	const rows = (await readFile(file, "utf8"))
		.trim()
		.split("\n")
		.map(JSON.parse);
	return rows
		.filter(
			(row) =>
				row.type === "response_item" &&
				row.payload.type === "message" &&
				["user", "assistant"].includes(row.payload.role),
		)
		.map((row, index) => ({
			id: `history-${index}`,
			role: row.payload.role,
			text: row.payload.content
				.map((part) => part.text ?? "")
				.join("\n\n"),
			order: index,
		}));
}

/** サンプルの実行時間をファイル名で集計し、Markdown 解析の占有時間を特定する。 */
function sampledTime(profile, functions = false) {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const times = new Map();
	for (const [index, id] of profile.samples.entries()) {
		const frame = nodes.get(id).callFrame;
		const key = functions
			? frame.functionName
			: frame.url.split("/").at(-1)?.split("?")[0] || frame.functionName;
		times.set(
			key,
			(times.get(key) ?? 0) + profile.timeDeltas[index] / 1000,
		);
	}
	return [...times].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

/** 入力処理を始めた時刻から、次の描画を終えるまでをブラウザー内で測る。 */
function recordInputFrame(element) {
	const { performance, requestAnimationFrame, MutationObserver } = globalThis;
	globalThis.inputCommits = [];
	let started = 0;
	let previous = element.textContent;
	new MutationObserver(() => {
		const text = element.textContent;
		if (text !== previous) {
			globalThis.inputCommits.push({
				ms: performance.now() - started,
				length: text.length,
			});
			previous = text;
		}
	}).observe(element, {
		characterData: true,
		childList: true,
		subtree: true,
	});
	const frame = async () => {
		const start = performance.now();
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
		return performance.now() - start;
	};
	element.addEventListener("beforeinput", () => {
		started = performance.now();
		globalThis.inputFrame = frame();
	});
	element.addEventListener(
		"keydown",
		() => {
			started = performance.now();
			globalThis.inputFrame = frame();
		},
		true,
	);
}

/** 通信時に過去の発言も複製される条件を再現し、変更した回答の描画時間を測る。 */
async function responseFrame({ messages, index }) {
	const { document, performance, requestAnimationFrame } = globalThis;
	const start = performance.now();
	document.querySelector("[data-story-chat]").storyBridge.patchState({
		messages: [
			...messages,
			{
				id: "new-answer",
				role: "assistant",
				text: `更新された回答 ${index}`,
			},
		],
	});
	await new Promise(requestAnimationFrame);
	await new Promise(requestAnimationFrame);
	return performance.now() - start;
}

/** 同じ履歴・更新回数で、入力から描画までの待ち時間と Host 差分の描画時間を測る。 */
async function measure(page, messages) {
	await page.evaluate((messages) => {
		const { document } = globalThis;
		document
			.querySelector("[data-story-chat]")
			.storyBridge.patchState({ messages, tools: [], run: "completed" });
	}, messages);
	await expect(page.locator(".message")).toHaveCount(messages.length);
	const input = page.getByRole("textbox");
	await input.click();
	await input.evaluate(recordInputFrame);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.start");
	const inputMs = [];
	for (let index = 0; index < 24; index++) {
		await input.press("a");
		inputMs.push(await page.evaluate(() => globalThis.inputFrame));
	}
	await expect(input).toHaveText("a".repeat(24));
	const profile = (await cdp.send("Profiler.stop")).profile;
	const inputProfile = sampledTime(profile);
	const inputFunctions = sampledTime(profile, true);
	const inputCommits = await page.evaluate(() => globalThis.inputCommits);
	await cdp.send("Profiler.start");
	for (let index = 0; index < 16; index++) {
		await page.keyboard.down("Backspace");
	}
	await page.keyboard.up("Backspace");
	await expect(input).toHaveText("a".repeat(8));
	const deletionProfile = sampledTime(
		(await cdp.send("Profiler.stop")).profile,
		true,
	);
	const deletionCommits = await page.evaluate(() =>
		globalThis.inputCommits.slice(24),
	);
	expect(deletionCommits.map((commit) => commit.length)).toEqual(
		Array.from({ length: 16 }, (_, index) => 23 - index),
	);
	await cdp.send("Profiler.start");
	const responseMs = [];
	for (let index = 0; index < 12; index++) {
		responseMs.push(
			await page.evaluate(responseFrame, { messages, index }),
		);
	}
	await expect(page.locator(".message").last()).toContainText(
		"更新された回答 11",
	);
	const responseProfile = sampledTime(
		(await cdp.send("Profiler.stop")).profile,
	);
	await cdp.detach();
	return {
		inputMs,
		inputCommits,
		inputFunctions,
		deletionCommits,
		deletionProfile,
		responseMs,
		inputProfile,
		responseProfile,
	};
}

/** 実行ごとの画像と計測値を保存し、狭幅・明暗テーマの実行時エラーも確認する。 */
async function main() {
	const messages = await history(process.argv[2]);
	const label = process.argv[3] ?? "measurement";
	const directory = join(
		"dist/ui-review",
		`chat-render-${label}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	const results = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 720 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-app--empty&viewMode=story&globals=theme:${theme}`,
			);
			await expect(page.getByRole("textbox")).toBeVisible();
			await page.evaluate(() => globalThis.document.fonts.ready);
			const measurement = await measure(page, messages);
			await page.screenshot({
				path: join(directory, `${theme}-bottom.png`),
			});
			await page
				.getByRole("region", { name: "会話", exact: true })
				.evaluate((element) => {
					element.scrollTop = 0;
				});
			await page.screenshot({
				path: join(directory, `${theme}-top.png`),
			});
			results.push({ theme, ...measurement });
			await page.close();
		}
		await writeFile(
			join(directory, "results.json"),
			JSON.stringify({ errors, results }, null, 2),
		);
		console.log(JSON.stringify({ directory, errors, results }, null, 2));
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
