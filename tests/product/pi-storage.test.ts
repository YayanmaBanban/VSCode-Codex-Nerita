// 本番の保存・履歴選択を通し、別のコントローラーでの復元と失敗時のデータ保持を検証する。
import assert from "node:assert/strict";
import {
	readFile,
	writeFile,
	mkdir,
	readdir,
	rename,
	access,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { piFixture, send, finished, sessionFiles } from "../support/pi";
import { restoredState } from "../support/restoredState";
import { readPiSessionHeader } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionHeader";

void test("Pi の履歴ヘッダーを UTF-8 の分割位置をまたいで読み、空・別種・上限超過・取り消しを拒否する", async (t) => {
	const f = await piFixture(t);
	const file = join(f.root, "header.jsonl");
	const signal = new AbortController().signal;
	const header = {
		type: "session",
		id: "header-id",
		cwd: "日本語🐈".repeat(2000),
	};
	await writeFile(
		file,
		`\ninvalid\n${JSON.stringify(header)}\n${"本文".repeat(1000000)}`,
	);
	assert.deepEqual(await readPiSessionHeader(file, signal), {
		id: "header-id",
	});
	await writeFile(file, JSON.stringify(header));
	assert.deepEqual(await readPiSessionHeader(file, signal), {
		id: "header-id",
	});
	for (const invalid of [
		"",
		'{"type":"message"}\n',
		" ".repeat(1024 * 1024) + JSON.stringify(header),
	]) {
		await writeFile(file, invalid);
		await assert.rejects(readPiSessionHeader(file, signal));
		assert.equal(await readFile(file, "utf8"), invalid);
	}
	const cancelled = new AbortController();
	cancelled.abort();
	await assert.rejects(readPiSessionHeader(file, cancelled.signal), {
		name: "AbortError",
	});
});
void test("送信した会話を別接続で復元し、フォーク後の送信で元ファイルを変更しない", async (t) => {
	const f = await piFixture(t);
	f.model.replies.push("最初の回答", "分岐先の回答");
	const first = f.controller();
	await first.connect();
	await send(first, "元の質問");
	const original = await finished(first);
	assert.equal(original.error, null);
	assert.equal(original.messages.length, 2);
	const saved = await sessionFiles(f.cwd);
	assert.equal(saved.length, 1);
	await first.dispose();
	const independent = await restoredState(f, original.sessionId!);
	assert.deepEqual(
		independent.messages.map(({ role, text }) => ({ role, text })),
		[
			{ role: "user", text: "元の質問" },
			{ role: "assistant", text: "最初の回答" },
		],
	);
	const second = f.controller();
	await second.connect();
	await second.receive({ type: "session/list", requestId: "list" });
	assert.ok(
		second
			.snapshot()
			.sessions.some((row) => row.sessionId === original.sessionId),
	);
	await second.receive({
		type: "session/load",
		requestId: "load",
		sessionId: original.sessionId,
	});
	assert.equal(f.model.requests.length, 1);
	await second.receive({
		type: "session/fork",
		requestId: "fork",
		sessionId: original.sessionId,
	});
	assert.notEqual(second.snapshot().sessionId, original.sessionId);
	await send(second, "分岐先だけの質問");
	const forked = await finished(second);
	assert.equal(forked.error, null);
	assert.equal(forked.messages.length, 4);
	assert.equal(await readFile(saved[0]!.path, "utf8"), saved[0]!.text);
	assert.equal((await sessionFiles(f.cwd)).length, 2);
	await second.dispose();
	const moved = join(f.root, "moved-workspace");
	assert.equal(dirname(f.cwd), f.root);
	assert.equal(dirname(moved), f.root);
	await rename(f.cwd, moved);
	const afterMove = await restoredState(
		{ ...f, cwd: moved },
		original.sessionId!,
	);
	assert.deepEqual(afterMove.messages, independent.messages);
	assert.equal(afterMove.cwd, moved);
	assert.equal((await sessionFiles(moved)).length, 2);
	await assert.rejects(access(f.cwd), { code: "ENOENT" });
});
void test("初回送信前の保存先衝突を通知し、元ファイルと下書きを守り、別の場所へ保存しない", async (t) => {
	const f = await piFixture(t);
	f.storage("global");
	const controller = f.controller();
	await controller.connect();
	const previousId = controller.snapshot().sessionId;
	await mkdir(join(f.cwd, ".pi"), { recursive: true });
	const collision = join(f.cwd, ".pi/sessions");
	await writeFile(collision, "keep");
	f.storage("workspace");
	const events: unknown[] = [];
	controller.subscribe((event) => events.push(event));
	const request = await send(controller, "再送する下書き");
	assert.equal(controller.snapshot().sessionId, previousId);
	assert.equal(await readFile(collision, "utf8"), "keep");
	assert.equal(f.model.requests.length, 0);
	const globalFiles = await readdir(join(f.agentDir, "sessions"), {
		recursive: true,
	});
	assert.ok(
		!globalFiles.some((file) => file.endsWith(".jsonl")),
		"衝突後にグローバル側へ退避保存しない",
	);
	assert.ok(
		events.some(
			(event) =>
				JSON.stringify(event).includes('"type":"request/failed"') &&
				JSON.stringify(event).includes(request.requestId),
		),
	);
	assert.ok(
		!events.some((event) =>
			JSON.stringify(event).includes('"type":"prompt/accepted"'),
		),
	);
});
void test("一覧取得後に履歴が破損しても現在の会話と元ファイルを保持する", async (t) => {
	const f = await piFixture(t);
	f.model.replies.push("保存する回答", "現在の回答");
	const controller = f.controller();
	await controller.connect();
	await send(controller, "過去の質問");
	const original = await finished(controller);
	const [saved] = await sessionFiles(f.cwd);
	assert.ok(saved);
	await controller.receive({ type: "session/new", requestId: "new" });
	await send(controller, "現在の質問");
	const current = await finished(controller);
	await controller.receive({ type: "session/list", requestId: "list" });
	await writeFile(saved.path, "broken");
	await controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: original.sessionId,
	});
	assert.equal(controller.snapshot().sessionId, current.sessionId);
	assert.deepEqual(controller.snapshot().messages, current.messages);
	assert.ok(controller.snapshot().sessionsError);
	assert.equal(await readFile(saved.path, "utf8"), "broken");
	assert.equal(f.model.requests.length, 2);
});
