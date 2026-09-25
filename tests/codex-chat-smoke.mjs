// 実 App Server で返信・停止・同じ会話への再送を検証する。認証済み環境でモデルを呼び出す。
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const extensionPath = path.resolve(process.argv[2] ?? ".");
const cwd = path.resolve("dist", "codex chat smoke", randomUUID());
await mkdir(cwd, { recursive: true });
const outfile = path.resolve("dist/codex-smoke/chat.mjs");
await build({
	stdin: {
		contents:
			'export { CodexClient } from "./src/extension/backends/codex/CodexClient"; export { CodexSessionController } from "./src/extension/backends/codex/CodexSessionController";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile,
	plugins: [
		{
			name: "vscode-smoke-boundary",
			/** VS Code 外のモデル疎通ではエディター操作を提供せず、誤用は失敗させる。 */
			setup(builder) {
				builder.onResolve({ filter: /^vscode$/ }, () => ({
					path: "vscode",
					namespace: "vscode-smoke-boundary",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "vscode-smoke-boundary" },
					() => ({
						contents:
							"module.exports = { workspace: {}, window: {} };",
						loader: "js",
					}),
				);
			},
		},
	],
});
const { CodexClient, CodexSessionController } = await import(
	pathToFileURL(outfile).href
);
const session = new CodexSessionController(async (callbacks, signal) => {
	const client = await CodexClient.connect({
		extensionPath,
		cwd,
		callbacks,
		signal,
		clientInfo: {
			name: "vscode_codex_smoke",
			title: "VS Code Codex smoke",
			version: "0.0.1",
		},
	});
	// モデルへの疎通試験では、ファイルやツールに変更を加えない権限を明示する。
	return {
		cwd,
		client: {
			listThreads: (...args) => client.listThreads(...args),
			readThread: (...args) => client.readThread(...args),
			resumeThread: (...args) => client.resumeThread(...args),
			forkThread: (...args) => client.forkThread(...args),
			listTurns: (...args) => client.listTurns(...args),
			listItems: (...args) => client.listItems(...args),
			renameThread: (...args) => client.renameThread(...args),
			archiveThread: (...args) => client.archiveThread(...args),
			unarchiveThread: (...args) => client.unarchiveThread(...args),
			listModels: (cursor) => client.listModels(cursor),
			readRateLimits: () => client.readRateLimits(),
			login: (params) => client.login(params),
			cancelLogin: (id) => client.cancelLogin(id),
			readAccount: () => client.readAccount(),
			startThread: (params) =>
				client.startThread({
					...params,
					sandbox: "read-only",
					approvalPolicy: "never",
				}),
			startTurn: (params) => client.startTurn(params),
			interruptTurn: (threadId, turnId) =>
				client.interruptTurn(threadId, turnId),
			dispose: () => client.dispose(),
		},
	};
});
/** 任意のターン終端まで通知で待ち、停止しない場合にも接続を解放する。 */
function waitForEnd() {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("Turn timeout"));
		}, 90000);
		const check = () => {
			const state = session.snapshot();
			if (!["running", "cancelling"].includes(state.run)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(state);
			}
		};
		const unsubscribe = session.subscribe(check);
		check();
	});
}
/** 現在の会話へ短い疎通確認を送り、確定応答を確認する。 */
async function reply(marker) {
	await session.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: session.snapshot().sessionId,
		text: `Reply with exactly ${marker}. Do not use tools or modify files.`,
	});
	const result = await waitForEnd();
	assert.equal(result.run, "completed", result.error ?? "Turn failed");
	assert.ok(
		result.messages.some(
			(message) =>
				message.role === "assistant" && message.text.includes(marker),
		),
	);
}
try {
	await session.connect();
	assert.equal(
		session.snapshot().connection,
		"ready",
		session.snapshot().error ?? "Connection failed",
	);
	const threadId = session.snapshot().sessionId;
	await reply("APP_SERVER_PHASE1_OK");
	console.log("Agent reply OK");
	await session.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: threadId,
		text: "Output the integers from 1 to 10000, one per line. Do not use tools or modify files.",
	});
	assert.equal(session.snapshot().run, "running");
	await session.receive({
		type: "prompt/cancel",
		requestId: randomUUID(),
		sessionId: threadId,
		runId: session.snapshot().runId,
	});
	assert.equal((await waitForEnd()).run, "cancelled");
	console.log("Turn interrupt OK");
	await reply("APP_SERVER_CONTINUE_OK");
	assert.equal(session.snapshot().sessionId, threadId);
	console.log("Continue on the same thread OK");
} finally {
	await session.dispose();
}
