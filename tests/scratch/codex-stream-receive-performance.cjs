// 実行: node --test tests/scratch/codex-stream-receive-performance.cjs
// 合成した JSONL だけを使い、パイプ投入から Worker・状態更新・通知までの遅延を測る。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");
const { mkdtemp, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/** 利用者の履歴を使わず、メッセージ数と文字数を揃えた状態を作る。 */
function createSession(api, historyCount) {
	const session = new api.SessionState();
	session.receive = async () => session.patch({ run: "running" });
	session.dispose = async () => session.clearListeners();
	session.invalidate = () => {};
	session.patch({
		runId: "probe",
		cwd: process.cwd(),
		messages: Array.from({ length: historyCount }, (_, i) => ({
			id: `history-${i}`,
			role: i % 2 ? "assistant" : "user",
			text: "履歴本文。".repeat(400),
			order: i,
		})),
	});
	return session;
}

/** 通信内容を記録せず、コピー・直列化の模擬負荷と配信回数だけを測る。 */
function notificationProbe(session) {
	const metrics = { published: 0, notificationBytes: 0, simulatedSendMs: 0 };
	const unsubscribe = session.subscribe((event) => {
		const started = performance.now();
		// IPC と UI 描画は含まず、実際の VS Code 通信時間を表す値ではない。
		structuredClone(event);
		metrics.published++;
		metrics.notificationBytes += Buffer.byteLength(JSON.stringify(event));
		metrics.simulatedSendMs += performance.now() - started;
	});
	return { metrics, unsubscribe };
}

/** 製品コードの経路をそのまま使い、履歴量だけを切り替える。 */
async function measure(api, historyCount, paced, consumeState = true) {
	const session = createSession(api, historyCount);
	const runtime = new api.BackendRuntime(() => session, undefined, {
		acquire: async () => async () => {},
	});
	await runtime.scope("chat").receive({
		type: "prompt/send",
		requestId: "probe",
		sessionId: "probe",
		text: "probe",
	});
	const { metrics, unsubscribe } = notificationProbe(runtime.scope("chat"));
	let snapshotMs = 0;
	let patchMs = 0;
	const latencies = [];
	const input = new PassThrough();
	const warmup = Promise.withResolvers();
	const completion = Promise.withResolvers();
	const count = 400;
	const reader = new api.AppServerJsonReader(
		input,
		(value) => {
			if (value.warmup) {
				warmup.resolve();
				return;
			}
			if (consumeState) {
				let started = performance.now();
				// CodexSessionController が注入する stateAccess と同じ経路。公開snapshotは使わない。
				const state = session.state;
				snapshotMs += performance.now() - started;
				started = performance.now();
				session.patch(
					api.messagePatch(state, "answer", value.delta, true),
				);
				patchMs += performance.now() - started;
			}
			latencies.push(performance.now() - value.sentAt);
			if (latencies.length === count) {
				completion.resolve();
			}
		},
		() => {},
	);
	try {
		input.write('{"warmup":true}\n');
		await warmup.promise;
		const started = performance.now();
		await sendDeltas(input, count, paced);
		await completion.promise;
		const elapsedMs = performance.now() - started;
		const snapshot = session.snapshot();
		if (consumeState) {
			assert.equal(snapshot.messages.at(-1).text.length, 2000);
		}
		latencies.sort((a, b) => a - b);
		return {
			historyCount,
			paced,
			consumeState,
			elapsedMs,
			snapshotMs,
			patchMs,
			p50Ms: latencies[200],
			p95Ms: latencies[380],
			maxMs: latencies.at(-1),
			published: metrics.published,
			notificationMiB: metrics.notificationBytes / 1048576,
			simulatedSendMs: metrics.simulatedSendMs,
		};
	} finally {
		unsubscribe();
		await reader.dispose();
		await runtime.dispose();
	}
}

/** 通知の集中到着と継続到着を同じ本文量で再現する。 */
async function sendDeltas(input, count, paced) {
	for (let i = 0; i < count; i++) {
		input.write(
			`${JSON.stringify({ delta: "生成本文。", sentAt: performance.now() })}\n`,
		);
		if (paced) {
			await delay(5);
		}
	}
}

for (const phase of ["baseline", "after"]) {
	test(
		`Codex 受信 ${phase}: 履歴量による差分処理と通知の遅延`,
		{ timeout: 60000 },
		async () => {
			const root = await mkdtemp(
				path.join("dist", "codex-stream-receive-"),
			);
			const bundle = path.resolve(root, "api.cjs");
			await require("esbuild").build({
				stdin: {
					contents: `
			export { AppServerJsonReader } from './apps/vscode-nerita/src/extension/backends/codex/runtime/AppServerJsonReader';
			export { SessionState } from './apps/vscode-nerita/src/extension/session/sessionState';
				export { BackendRuntime } from './apps/vscode-nerita/src/extension/session/BackendRuntime';
			export { messagePatch } from './apps/vscode-nerita/src/extension/backends/codex/items/chatItems';
		`,
					resolveDir: process.cwd(),
				},
				outfile: bundle,
				bundle: true,
				platform: "node",
				format: "cjs",
				conditions: ["nerita-source"],
				// 製品ソースは書き換えず、修正前の追跡済みファイルだけを読取り専用でバンドルする。
				plugins: phase === "baseline" ? [baselineSources()] : [],
			});
			const api = require(bundle);
			const results = [await measure(api, 0, false, false)];
			for (const historyCount of [0, 200, 1000]) {
				for (const paced of [false, true]) {
					const result = await measure(api, historyCount, paced);
					results.push(result);
					console.log(JSON.stringify(result));
				}
			}
			await writeFile(
				path.join(root, "results.json"),
				JSON.stringify(
					{ phase, node: process.version, results },
					null,
					2,
				),
			);
			console.log(root);
		},
	);
}

/** 修正前の接続経路を再現する。対象外の依存・実行環境は修正後と共通にする。 */
function baselineSources() {
	const files = new Set([
		"apps/vscode-nerita/src/extension/session/BackendRuntime.ts",
		"apps/vscode-nerita/src/extension/session/statePublisher.ts",
		"packages/shared/src/messages.ts",
		"packages/shared/src/toolUpdates.ts",
		"packages/shared/src/hostMessageValidation.ts",
	]);
	return {
		name: "baseline-sources",
		setup(build) {
			build.onLoad({ filter: /\.ts$/ }, ({ path: file }) => {
				const relative = path
					.relative(process.cwd(), file)
					.replaceAll("\\", "/");
				if (!files.has(relative)) {
					return;
				}
				return {
					contents: execFileSync(
						"git",
						["show", `HEAD:${relative}`],
						{ encoding: "utf8", windowsHide: true },
					),
					loader: "ts",
				};
			});
		},
	};
}
