// 配布用 Pi SDK の履歴を実際に読み、圧縮要約と原文参照を検証する。
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

test("Pi の保存済み履歴を変更せず、圧縮要約と保持範囲を読み込む", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "nerita-handoff-"));
	t.after(async () => {
		assert.equal(path.dirname(root), tmpdir());
		assert.ok(path.basename(root).startsWith("nerita-handoff-"));
		await rm(root, { recursive: true, force: true });
	});
	const sdk = await import(
		new URL("../dist/runtime/pi.mjs", import.meta.url).href
	);
	const target = path.join(root, "store.mjs");
	await build({
		entryPoints: ["src/extension/backends/pi/PiSessionStore.ts"],
		outfile: target,
		platform: "node",
		format: "esm",
		bundle: true,
	});
	const { openPiSessionStore, preparePiSessionDirectory } = await import(
		pathToFileURL(target).href
	);
	const directory = path.join(root, ".sessions");
	await preparePiSessionDirectory(directory, "workspace");
	const source = sdk.SessionManager.create(root, directory);
	source.appendMessage({
		role: "user",
		content: "old-original-message",
		timestamp: 1,
	});
	const kept = source.appendMessage({
		role: "user",
		content: "retained-message",
		timestamp: 2,
	});
	source.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "completed" }],
		api: "openai-completions",
		provider: "test",
		model: "test",
		stopReason: "stop",
		timestamp: 3,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
	});
	source.appendCompaction("saved-summary", kept, 1000);
	const file = source.getSessionFile();
	const before = await readFile(file, "utf8");
	const { manager, history } = await openPiSessionStore(
		sdk,
		root,
		path.join(root, "agent"),
		"workspace",
		new AbortController().signal,
	);
	const currentId = manager.getSessionId();
	const raw = await history.readContext(
		source.getSessionId(),
		"transcript",
		new AbortController().signal,
	);
	const handoff = await history.readContext(
		source.getSessionId(),
		"handoff",
		new AbortController().signal,
	);
	assert.match(raw, /old-original-message/);
	assert.doesNotMatch(raw, /saved-summary/);
	assert.match(handoff, /saved-summary/);
	assert.match(handoff, /retained-message/);
	assert.doesNotMatch(handoff, /old-original-message/);
	assert.equal(manager.getSessionId(), currentId);
	assert.equal(await readFile(file, "utf8"), before);
	const foreign = sdk.SessionManager.create(
		path.join(root, "other"),
		directory,
	);
	foreign.appendMessage({ role: "user", content: "outside", timestamp: 4 });
	foreign.appendMessage(
		source
			.getBranch()
			.find(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant",
			).message,
	);
	const candidates = await history.list(new AbortController().signal, true);
	assert.ok(
		candidates.some((row) => row.sessionId === source.getSessionId()),
	);
	assert.ok(
		!candidates.some((row) => row.sessionId === foreign.getSessionId()),
	);
	await assert.rejects(
		history.readContext(
			foreign.getSessionId(),
			"handoff",
			new AbortController().signal,
		),
	);
	await assert.rejects(
		history.readContext(
			currentId,
			"transcript",
			new AbortController().signal,
		),
	);
});
