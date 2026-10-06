// 通常ツールの大きな結果を、本番の機能設定・SDK・共有状態・保存・復元へ通す。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";

import {
	piFixture,
	send,
	finished,
	permission,
	sessionFiles,
} from "../support/pi";

for (const [toolSearch, codemode] of [
	[false, false],
	[true, false],
	[false, true],
	[true, true],
] as const) {
	void test(`通常ツールの大きな結果を保持する（検索=${toolSearch}、コード実行=${codemode}）`, (t) =>
		verifyPiResultHistory(t, toolSearch, codemode));
}

void test(
	"コード実行の子の全文を別ファイルへ保存し、再接続とフォークで共有する",
	verifyNestedOutputArchive,
);

void test("出力の保存失敗を通知し、存在しない本文への参照を JSONL に残さない", async (t) => {
	const f = await piFixture(t);
	await prepareLargeResultExtension(f, false, true);
	f.model.replies.push(
		{
			name: "codemode",
			arguments: { code: "await tools.large_result({}); text('完了');" },
		},
		"終了",
	);
	const controller = f.controller();
	await controller.connect();
	await writeFile(
		join(f.cwd, ".pi", "sessions", controller.snapshot().sessionId!),
		"保存先を塞ぐ",
	);
	await send(controller, "保存失敗の確認");
	await permission(controller, "accept");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.match(state.error!, /ツール出力を保存できません/u);
	assert.equal(state.run, "failed");
	const saved = await sessionFiles(f.cwd);
	assert.ok(!saved[0]!.text.includes("nerita.tool-output.v1"));
});

/** SDK が要約だけを保存する子の結果を、実際の JSONL と範囲取得で検証する。 */
async function verifyNestedOutputArchive(t: TestContext) {
	const f = await piFixture(t);
	await prepareLargeResultExtension(f, false, true);
	f.model.replies.push(
		{
			name: "codemode",
			arguments: { code: "await tools.large_result({}); text('完了');" },
		},
		"終了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "子の長い結果を保存");
	await permission(controller, "accept");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null);
	const child = state.tools.find((tool) =>
		isNonEmptyString(tool.parentToolCallId),
	);
	assert.ok(child);
	const output = await readOutput(controller, child);
	assert.match(output, /末尾$/u, "子の大きな結果を JSON の途中で切断しない");
	assert.ok(!output.includes("sk-rebuild-secret"));
	const folder = join(f.cwd, ".pi", "sessions", state.sessionId!, "outputs");
	const files = await readdir(folder);
	assert.equal(files.length, 1);
	assert.match(files[0]!, /^[a-f0-9-]{36}\.txt$/u);
	assert.equal(await readFile(join(folder, files[0]!), "utf8"), output);
	const saved = await sessionFiles(f.cwd);
	assert.ok(saved[0]!.text.includes("nerita.tool-output.v1"));
	assert.ok(Buffer.byteLength(saved[0]!.text) < 20000);
	await controller.dispose();
	const restored = f.controller();
	await restored.connect();
	await restored.receive({ type: "session/list", requestId: "list" });
	await restored.receive({
		type: "session/load",
		requestId: "load",
		sessionId: state.sessionId,
	});
	assert.equal(
		await readOutput(
			restored,
			restored.snapshot().tools.find((tool) => tool.id === child.id)!,
		),
		output,
	);
	await restored.receive({
		type: "session/fork",
		requestId: "fork",
		sessionId: state.sessionId,
	});
	assert.notEqual(restored.snapshot().sessionId, state.sessionId);
	assert.equal(
		await readOutput(
			restored,
			restored.snapshot().tools.find((tool) => tool.id === child.id)!,
		),
		output,
	);
	assert.deepEqual(await readdir(folder), files);
	await restored.dispose();
	await unlink(join(folder, files[0]!));
	const missing = f.controller();
	await missing.connect();
	await missing.receive({ type: "session/list", requestId: "list-missing" });
	await missing.receive({
		type: "session/load",
		requestId: "load-missing",
		sessionId: state.sessionId,
	});
	const unavailable = missing
		.snapshot()
		.tools.find((tool) => tool.id === child.id);
	assert.ok(unavailable?.output?.truncated === true);
	assert.equal(unavailable.output.outputRef, undefined);
	assert.match(unavailable.output.preview, /末尾/u);
}

void test("コード実行からの書込みも個別承認を要求し、親子の結果を復元する", async (t) => {
	const f = await piFixture(t);
	Object.assign(f.options, { codemode: true, toolSearch: true });
	f.model.replies.push(
		{
			name: "codemode",
			arguments: {
				code: "text(await tools.write({ path: 'code.txt', content: 'approved-from-code' }));",
			},
		},
		"コード実行完了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "コードからファイルを作成");
	await permission(controller, "accept");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null);
	assert.equal(
		await readFile(join(f.cwd, "code.txt"), "utf8"),
		"approved-from-code",
	);
	assert.equal(state.tools.length, 2);
	assert.ok(
		state.tools.every((tool) => tool.status === "completed"),
		JSON.stringify(state.tools),
	);
	const child = state.tools.find((tool) =>
		isNonEmptyString(tool.parentToolCallId),
	);
	assert.ok(child);
	assert.ok(state.tools.some((tool) => tool.id === child.parentToolCallId));
	await controller.dispose();
	const restored = f.controller();
	await restored.connect();
	await restored.receive({ type: "session/list", requestId: "list" });
	await restored.receive({
		type: "session/load",
		requestId: "load",
		sessionId: state.sessionId,
	});
	assert.deepEqual(
		restored.snapshot().tools.map(({ id, parentToolCallId, status }) => ({
			id,
			parentToolCallId,
			status,
		})),
		state.tools.map(({ id, parentToolCallId, status }) => ({
			id,
			parentToolCallId,
			status,
		})),
	);
	assert.equal(f.model.requests.length, 2);
});

/** 長いツール結果を保存・復元し、機能設定に応じた秘密除去を維持する。 */
async function verifyPiResultHistory(
	t: TestContext,
	toolSearch: boolean,
	codemode: boolean,
) {
	const f = await piFixture(t);
	const { extensionRoot } = await prepareLargeResultExtension(
		f,
		toolSearch,
		codemode,
	);
	if (toolSearch) {
		f.model.replies.push({
			name: "tool_search",
			arguments: { query: "large_result" },
		});
	}
	f.model.replies.push({ name: "large_result", arguments: {} }, "結果を受領");
	const controller = f.controller();
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		controller.snapshot().error ?? "",
	);
	await send(controller, "大きな結果を取得");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null);
	const result = state.tools.find((tool) => tool.title === "large_result");
	assert.ok(result);
	assert.ok(result.output);
	assert.ok(
		result.output.truncated,
		"大きなツール結果の本文を切断せず範囲取得へ渡す",
	);
	assert.ok(result.output.preview.length < 2200);
	assert.match(result.output.preview, /末尾/u);
	const liveOutput = await readOutput(controller, result);
	assert.match(liveOutput, /末尾$/u);
	assert.equal(
		result.status,
		"completed",
		result.status === "failed" ? JSON.stringify(result) : "",
	);
	assert.ok(
		f.model.requests.at(-1)?.includes("末尾") === true,
		"モデルに正常な結果の末尾が届く",
	);
	const saved = await sessionFiles(f.cwd);
	assert.equal(saved.length, 1);
	assert.ok(saved[0]!.text.includes("末尾"));
	if (toolSearch || codemode) {
		assert.ok(!saved[0]!.text.includes("sk-rebuild-secret"));
		assert.ok(!f.model.requests.at(-1)!.includes("sk-rebuild-secret"));
		assert.ok(!JSON.stringify(state.tools).includes("sk-rebuild-secret"));
	}
	await controller.dispose();
	const restored = f.controller();
	await restored.connect();
	await restored.receive({ type: "session/list", requestId: "list" });
	await restored.receive({
		type: "session/load",
		requestId: "load",
		sessionId: state.sessionId,
	});
	const restoredResult = restored
		.snapshot()
		.tools.find((tool) => tool.title === "large_result");
	assert.equal(restoredResult?.status, "completed");
	assert.notEqual(restoredResult, undefined);
	assert.ok(restoredResult.output);
	assert.equal(restoredResult.output.preview, result.output.preview);
	assert.equal(await readOutput(restored, restoredResult), liveOutput);
	assert.equal(f.model.requests.length, toolSearch ? 3 : 2);
	assert.equal(
		await readFile(join(extensionRoot, "effects.txt"), "utf8"),
		"executed\n",
	);
}

/** 実際の通信契約で全範囲を読み、保存・再接続後の欠落を検出する。 */
async function readOutput(controller: PiSessionController, tool: ToolSummary) {
	assert.ok(isNonEmptyString(tool.output?.outputRef));
	let text = "";
	let offset = 0;
	while (true) {
		const requestId = randomUUID();
		let response: ToolOutputResponse | undefined;
		const unsubscribe = controller.subscribe((message) => {
			if (
				message.type === "tool/outputResult" &&
				message.requestId === requestId
			) {
				response = message;
			}
		});
		try {
			await controller.receive({
				type: "tool/output",
				requestId,
				outputRef: tool.output.outputRef,
				offset,
				limit: 65536,
			});
		} finally {
			unsubscribe();
		}
		assert.ok(response);
		assert.equal(response.error, undefined);
		assert.ok(Buffer.byteLength(response.text) <= 65536);
		text += response.text;
		if (response.eof) {
			return text;
		}
		assert.ok(response.nextOffset > offset);
		offset = response.nextOffset;
	}
}

/** 長い結果と秘密値を返す信頼済み拡張を用意する。 */
async function prepareLargeResultExtension(
	f: Awaited<ReturnType<typeof piFixture>>,
	toolSearch: boolean,
	codemode: boolean,
) {
	const extensionRoot = join(f.root, "trusted-extension");
	await mkdir(extensionRoot);
	const extension = join(extensionRoot, "result.mjs");
	const body = `先頭 sk-rebuild-secret ${"検証".repeat(150000)}末尾`;
	await writeFile(
		join(extensionRoot, "result.json"),
		JSON.stringify({
			content: [{ type: "text", text: body }],
			details: {},
		}),
	);
	await writeFile(
		extension,
		`import { readFile, appendFile } from 'node:fs/promises';
export default function (pi) {
 pi.registerTool({ name: 'large_result', label: 'large result', description: 'return a large result', parameters: { type: 'object', properties: {} },
 async execute() { await appendFile(new URL('./effects.txt', import.meta.url), 'executed\\n'); return JSON.parse(await readFile(new URL('./result.json', import.meta.url), 'utf8')); } });
}`,
	);
	await f.trust.setUserTrust(extensionRoot, true);
	Object.assign(f.options, {
		trustedExtensionPaths: [extension],
		toolSearch,
		codemode,
	});
	return { extensionRoot };
}
