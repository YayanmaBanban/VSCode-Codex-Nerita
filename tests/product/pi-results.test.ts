// 通常ツールの大きな結果を、本番の機能設定・SDK・共有状態・保存・復元へ通す。
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
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
	void test(`通常ツールの大きな結果を保持する（検索=${toolSearch}、コード実行=${codemode}）`, async (t) => {
		const f = await piFixture(t);
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
		if (toolSearch) {
			f.model.replies.push({
				name: "tool_search",
				arguments: { query: "large_result" },
			});
		}
		f.model.replies.push(
			{ name: "large_result", arguments: {} },
			"結果を受領",
		);
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
		const result = state.tools.find(
			(tool) => tool.title === "large_result",
		);
		assert.ok(result);
		assert.equal(
			result.status,
			"completed",
			result.status === "failed" ? JSON.stringify(result) : "",
		);
		assert.ok(
			f.model.requests.at(-1)?.includes("末尾"),
			"モデルに正常な結果の末尾が届く",
		);
		const saved = await sessionFiles(f.cwd);
		assert.equal(saved.length, 1);
		assert.ok(saved[0]!.text.includes("末尾"));
		if (toolSearch || codemode) {
			assert.ok(!saved[0]!.text.includes("sk-rebuild-secret"));
			assert.ok(!f.model.requests.at(-1)!.includes("sk-rebuild-secret"));
			assert.ok(
				!JSON.stringify(state.tools).includes("sk-rebuild-secret"),
			);
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
		assert.deepEqual(restoredResult?.content, result.content);
		assert.equal(f.model.requests.length, toolSearch ? 3 : 2);
		assert.equal(
			await readFile(join(extensionRoot, "effects.txt"), "utf8"),
			"executed\n",
		);
	});
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
	const child = state.tools.find((tool) => tool.parentToolCallId);
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
