// 専用cwdで作った会話だけを使い、実App Serverの保存・復元・可逆操作を検証する。
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const cwd = path.resolve("dist", "codex history smoke", randomUUID());
await mkdir(cwd, { recursive: true });
const outfile = path.resolve("dist/codex-smoke/history.mjs");
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
});
const { CodexClient, CodexSessionController } = await import(
	pathToFileURL(outfile).href
);
let native;
const created = new Set();
const session = new CodexSessionController(async (callbacks, signal) => {
	native = await CodexClient.connect({
		extensionPath: process.cwd(),
		cwd,
		callbacks,
		signal,
		clientInfo: {
			name: "vscode_codex_history_smoke",
			title: "History smoke",
			version: "0.0.1",
		},
	});
	const client = new Proxy(native, {
		get(target, key) {
			if (key === "startThread") {
				return async (params) => {
					const result = await target.startThread({
						...params,
						sandbox: "read-only",
						approvalPolicy: "never",
					});
					created.add(result.thread.id);
					return result;
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { client, cwd };
});
/** 状態通知を待ち、無応答時は期限付きで失敗する。 */
function waitFor(predicate) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("History smoke timeout"));
		}, 90000);
		const check = () => {
			const state = session.snapshot();
			if (predicate(state)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(state);
			}
		};
		const unsubscribe = session.subscribe(check);
		check();
	});
}
/** 一つの履歴操作を実際のUI要求として送る。 */
async function action(type, fields = {}) {
	let error;
	const unsubscribe = session.subscribe((message) => {
		if (message.type === "request/failed") {
			error = message.error;
		}
	});
	await session.receive({ type, requestId: randomUUID(), ...fields });
	unsubscribe();
	assert.equal(error, undefined, error);
	assert.equal(
		session.snapshot().sessionsError,
		null,
		session.snapshot().sessionsError ?? "",
	);
}
try {
	await session.connect();
	assert.equal(
		session.snapshot().connection,
		"ready",
		session.snapshot().error ?? "",
	);
	const id = session.snapshot().sessionId;
	await action("prompt/send", {
		sessionId: id,
		text: "Reply exactly HISTORY_SAVED_OK. Do not use tools or change files.",
	});
	const completed = await waitFor(
		(s) => !["running", "cancelling"].includes(s.run),
	);
	assert.equal(completed.run, "completed", completed.error ?? "");
	await action("session/list");
	assert.ok(
		session.snapshot().sessions.some((s) => s.sessionId === id),
		"Created thread not listed",
	);
	await action("session/rename", {
		sessionId: id,
		name: "履歴の実接続テスト",
	});
	assert.equal(
		session.snapshot().sessions.find((s) => s.sessionId === id)?.title,
		"履歴の実接続テスト",
	);
	await action("session/new");
	await action("session/load", { sessionId: id });
	assert.equal(session.snapshot().sessionId, id);
	assert.ok(
		session
			.snapshot()
			.messages.some(
				(m) =>
					m.role === "assistant" &&
					m.text.includes("HISTORY_SAVED_OK"),
			),
	);
	console.log("Native list, rename, resume and messages OK");
	await action("session/fork", { sessionId: id });
	const fork = session.snapshot().sessionId;
	assert.notEqual(fork, id);
	created.add(fork);
	assert.ok(session.snapshot().messages.length >= 2);
	await action("session/delete", { sessionId: fork });
	assert.equal(session.snapshot().sessionId, null);
	await action("session/list", { archived: true });
	assert.ok(session.snapshot().sessions.some((s) => s.sessionId === fork));
	await action("session/unarchive", { sessionId: fork });
	await action("session/list", { archived: false });
	assert.ok(session.snapshot().sessions.some((s) => s.sessionId === fork));
	await action("session/load", { sessionId: fork });
	await action("prompt/send", {
		sessionId: fork,
		text: "Reply exactly HISTORY_RESUMED_OK. Do not use tools or change files.",
	});
	const resumed = await waitFor(
		(s) => !["running", "cancelling"].includes(s.run),
	);
	assert.equal(resumed.run, "completed", resumed.error ?? "");
	assert.ok(
		resumed.messages.some((m) => m.text.includes("HISTORY_RESUMED_OK")),
	);
	console.log("Native fork, archive, unarchive and continuation OK");
} finally {
	// このテスト自身が作成した会話だけをアーカイブし、既存の会話には触れない。
	for (const id of created) {
		try {
			await native?.archiveThread(id);
		} catch {
			/* 未保存または既にアーカイブ済み。 */
		}
	}
	await session.dispose();
}
