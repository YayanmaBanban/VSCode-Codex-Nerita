// HTTP MCP サーバーの結果と副作用を、承認・共有状態・保存・復元の各段階で検証する。
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { mcpServer } from "../support/mcpServer";
import { restoredState } from "../support/restoredState";
import {
	piFixture,
	send,
	finished,
	permission,
	sessionFiles,
} from "../support/pi";

/** ネットワーク通信を許可する方針と接続設定を準備し、承認への応答は各テストで行う。 */
async function fixture(t: TestContext, codemode = false) {
	const f = await piFixture(t);
	f.options.codemode = codemode;
	f.options.parentPolicy = {
		workspaceRoots: [f.cwd],
		writableRoots: [f.cwd],
		shell: false,
		networkAccess: true,
		windowsSandbox: "elevated",
	};
	const mcp = await mcpServer();
	t.after(() => mcp.close());
	await writeFile(
		join(f.agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				fixture: {
					url: mcp.url,
					enabled: true,
					exposure: "direct",
					headers: { Authorization: `Bearer ${mcp.token}` },
				},
			},
		}),
	);
	const controller = f.controller();
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		JSON.stringify(controller.snapshot()),
	);
	return { ...f, mcp, controller };
}

for (const source of ["structuredContent", "content"] as const) {
	void test(`MCP の ${source} と秘密除去・省略情報を保存後も保持する`, async (t) => {
		const f = await fixture(t);
		const png =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
		f.mcp.state.result = {
			content:
				source === "content"
					? [
							{ type: "image", data: png, mimeType: "image/png" },
							{
								type: "text",
								text: `日本語の結果 ${f.mcp.token} ${"表示".repeat(100000)}末尾`,
							},
						]
					: [],
			structuredContent: {
				count: 3,
				label: "日本語の結果",
				token: f.mcp.token,
			},
			_meta: { token: f.mcp.token },
		};
		f.model.replies.push(
			{ name: "mcp__fixture__change", arguments: {} },
			"受領",
		);
		await send(f.controller, "MCP を実行");
		await permission(f.controller, "accept");
		assert.equal(f.mcp.calls.length, 0);
		await permission(f.controller, "accept");
		const state = await finished(f.controller);
		assert.equal(state.tools.length, 1, JSON.stringify(state));
		const tool = state.tools[0]!;
		assert.equal(tool.status, "completed", JSON.stringify(tool));
		assert.ok(JSON.stringify(tool).includes("日本語の結果"));
		assert.deepEqual(
			tool.resultDisplay,
			{
				source,
				omitted: true,
			},
			"MCP の表示元と省略情報を維持する",
		);
		const saved = await sessionFiles(f.cwd);
		for (const value of [
			JSON.stringify(state),
			saved[0]!.text,
			f.model.requests.at(-1)!,
		]) {
			assert.ok(!value.includes(f.mcp.token));
			assert.ok(value.includes("日本語の結果"));
			assert.ok(!value.includes(png));
			if (source === "content") {
				assert.ok(value.includes("画像を読み取りました。"));
				assert.ok(!value.includes("末尾"));
			}
		}
		await f.controller.dispose();
		const restored = await restoredState(f, state.sessionId!);
		assert.equal(restored.tools.length, 1);
		const restoredTool = restored.tools[0]!;
		assert.equal(restoredTool.status, "completed");
		assert.deepEqual(restoredTool.content, tool.content);
		assert.deepEqual(restoredTool.resultDisplay, tool.resultDisplay);
		assert.equal(f.mcp.calls.length, 1);
		assert.equal(f.model.requests.length, 2);
	});
}

for (const outcome of ["deny", "error", "lost"]) {
	void test(`MCP の ${outcome} を成功とせず、自動再送しない`, async (t) => {
		const f = await fixture(t);
		f.mcp.state.outcome = outcome;
		f.model.replies.push(
			{ name: "mcp__fixture__change", arguments: {} },
			"結果を確認",
		);
		await send(f.controller, "MCP を実行");
		await permission(f.controller, "accept");
		assert.equal(f.mcp.calls.length, 0);
		await permission(
			f.controller,
			outcome === "deny" ? "decline" : "accept",
		);
		const state = await finished(f.controller);
		assert.equal(state.tools.length, 1);
		assert.equal(
			state.tools[0]!.status,
			outcome === "lost" ? "unknown" : "failed",
			JSON.stringify(state.tools),
		);
		const id = state.sessionId!;
		if (outcome === "lost") {
			await f.controller.receive({
				type: "session/list",
				requestId: "list",
			});
			await f.controller.receive({
				type: "session/fork",
				requestId: "fork",
				sessionId: id,
			});
			assert.notEqual(f.controller.snapshot().sessionId, id);
			assert.equal(f.controller.snapshot().tools[0]!.status, "unknown");
		}
		await f.controller.dispose();
		const restored = await restoredState(f, id);
		assert.equal(
			restored.tools[0]!.status,
			outcome === "lost" ? "unknown" : "failed",
		);
		assert.equal(f.mcp.calls.length, outcome === "deny" ? 0 : 1);
		assert.equal(f.model.requests.length, 2);
	});
}

void test("コード実行内の MCP 応答喪失を、子の保存・復元・フォークでも結果不明とする", async (t) => {
	const f = await fixture(t, true);
	f.mcp.state.outcome = "lost";
	f.model.replies.push(
		{
			name: "codemode",
			arguments: { code: "text(await tools.mcp__fixture__change({}));" },
		},
		"確認が必要",
	);
	await send(f.controller, "コードから遠隔更新");
	await permission(f.controller, "accept");
	await permission(f.controller, "accept");
	await permission(f.controller, "accept");
	const state = await finished(f.controller);
	const child = state.tools.find((tool) => tool.parentToolCallId);
	assert.equal(child?.status, "unknown", JSON.stringify(state.tools));
	await f.controller.receive({
		type: "session/list",
		requestId: "list-nested",
	});
	await f.controller.receive({
		type: "session/fork",
		requestId: "fork-nested",
		sessionId: state.sessionId!,
	});
	assert.notEqual(f.controller.snapshot().sessionId, state.sessionId);
	assert.equal(
		f.controller.snapshot().tools.find((tool) => tool.id === child.id)
			?.status,
		"unknown",
	);
	await f.controller.dispose();
	const restored = await restoredState(f, state.sessionId!);
	assert.equal(
		restored.tools.find((tool) => tool.id === child.id)?.status,
		"unknown",
		JSON.stringify(restored.tools),
	);
	assert.equal(f.mcp.calls.length, 1);
	assert.equal(f.model.requests.length, 2);
});
