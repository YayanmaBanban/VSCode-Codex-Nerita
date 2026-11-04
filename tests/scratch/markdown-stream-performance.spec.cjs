// 実行: `pnpm test:scratch markdown-stream-performance.spec.cjs --grep "累積 Markdown"`。
// `SCRATCH_PHASE` を `before` と `after` に設定して同じ条件で実行し、製品コンポーネントの更新時間を比較する。
const { test, expect, waitForStory } = require("../support/scratch-test.cjs");
const { writeFile } = require("node:fs/promises");

test("本文差分で履歴を保持して長文を確定 @layout", async ({
	reviewBrowser,
}, testInfo) => {
	const page = await reviewBrowser.newPage({
		viewport: { width: 520, height: 720 },
	});
	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-app--message-updates&viewMode=story",
	);
	await waitForStory(page);
	await page.evaluate(() => globalThis.document.fonts.ready);
	await page.screenshot({ path: testInfo.outputPath("message-updates.png") });
});

test("累積 Markdown の追記と確定 @performance", async ({
	reviewBrowser,
}, testInfo) => {
	const page = await reviewBrowser.newPage({
		viewport: { width: 520, height: 720 },
	});
	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-app--empty&viewMode=story",
	);
	await waitForStory(page);
	await page.evaluate(() => globalThis.document.fonts.ready);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.start");
	const result = await page.evaluate(measureStream);
	const { profile } = await cdp.send("Profiler.stop");
	await cdp.detach();
	await expect(page.locator(".message-markdown")).toContainText(
		"確定時に受信した末尾 🧑‍🔧",
	);
	const phase = process.env.SCRATCH_PHASE ?? "after";
	await page.screenshot({ path: testInfo.outputPath(`${phase}.png`) });
	await writeFile(
		testInfo.outputPath(`${phase}-profile.json`),
		JSON.stringify(profile),
	);
	const summary = { ...result, sampledMs: sampledTimes(profile) };
	await writeFile(
		testInfo.outputPath(`${phase}.json`),
		JSON.stringify(summary, null, 2),
	);
	console.log(JSON.stringify(summary));
});

/** 同じ本文への追記と完了通知を配信し、次の描画までの時間を測る。 */
async function measureStream() {
	const { document, requestAnimationFrame, performance } = globalThis;
	const bridge = document.querySelector("[data-story-chat]").storyBridge;
	const baseline = Array.from(
		{ length: 40 },
		(_, i) =>
			`### 項目 ${i}\n\n**説明**と[関連リンク](https://example.invalid/${i})を確認します。\n\n- 一つ目\n- 二つ目\n\n`,
	).join("");
	let text = baseline;
	const times = [];
	const publish = (streaming) =>
		bridge.patchState({
			messages: [
				{
					id: "measured",
					role: "assistant",
					text,
					streaming,
					order: 0,
				},
			],
			tools: [],
			run: streaming ? "running" : "completed",
		});
	publish(true);
	await new Promise(requestAnimationFrame);
	await new Promise(requestAnimationFrame);
	const original = document.querySelector(".message-markdown a");
	for (let i = 0; i < 60; i++) {
		text += "追加の説明を受信しています。";
		const start = performance.now();
		publish(true);
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
		times.push(performance.now() - start);
	}
	text += "\n\n確定時に受信した末尾 🧑‍🔧";
	const start = performance.now();
	publish(false);
	await new Promise(requestAnimationFrame);
	await new Promise(requestAnimationFrame);
	return {
		times,
		finalMs: performance.now() - start,
		preserved: original === document.querySelector(".message-markdown a"),
		length: text.length,
	};
}

/** プロファイラーの自己時間を集計し、更新による解析・リアクティビティの負荷を比較する。 */
function sampledTimes(profile) {
	const nodes = new Map(
		profile.nodes.map((node) => [node.id, node.callFrame]),
	);
	const sampled = new Map();
	profile.samples.forEach((id, i) => {
		const frame = nodes.get(id);
		const key = `${frame.functionName} ${frame.url.split("/").at(-1)?.split("?")[0]}`;
		sampled.set(
			key,
			(sampled.get(key) ?? 0) + profile.timeDeltas[i] / 1000,
		);
	});
	return [...sampled].sort((a, b) => b[1] - a[1]).slice(0, 20);
}
