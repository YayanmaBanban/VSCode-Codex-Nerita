// バイト境界・参照の失効・連続出力の保持量を、Host の取得契約で検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ToolOutputStore } from "../../apps/vscode-nerita/src/extension/session/ToolOutputStore";
import { setToolOutputSource } from "../../apps/vscode-nerita/src/extension/session/toolOutputSource";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";
import type { ToolSummary } from "@nerita/shared/chatState";
import { registerPiOutput } from "../../apps/vscode-nerita/src/extension/backends/pi/results/PiToolOutput";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { codexFixture } from "../support/codex";
import { until } from "../support/pi";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";

void test("UTF-8 の連続取得で日本語と絵文字を分断せず、参照失効後は読めない", async (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	const text = `先頭🐈${"日本語🙂abc".repeat(10000)}末尾エラー`;
	const tool = store.project({
		id: "output",
		title: "command",
		kind: "execute",
		status: "completed",
		paths: [],
		rawOutput: { formatted_output: text },
		rawItem: { aggregatedOutput: text },
	});
	assert.ok(tool.output?.outputRef);
	assert.ok(tool.output.preview.length < 2200);
	assert.ok(tool.output.preview.startsWith("先頭🐈"));
	assert.ok(tool.output.preview.endsWith("末尾エラー"));
	assert.equal(tool.rawOutput, undefined);
	assert.equal(tool.rawItem, undefined);
	let offset = 0;
	let reconstructed = "";
	while (true) {
		const response = await store.read({
			type: "tool/output",
			requestId: "read",
			outputRef: tool.output.outputRef,
			offset,
			limit: 101,
		});
		assert.equal(response.error, undefined);
		assert.ok(isHostMessage(response));
		assert.ok(!response.text.includes("�"));
		assert.ok(Buffer.byteLength(response.text) <= 101);
		reconstructed += response.text;
		if (response.eof) {
			break;
		}
		assert.ok(response.nextOffset > offset);
		offset = response.nextOffset;
	}
	assert.equal(reconstructed, text);
	store.dispose();
	assert.match(
		(
			await store.read({
				type: "tool/output",
				requestId: "expired",
				outputRef: tool.output.outputRef,
				offset: 0,
				limit: 64,
			})
		).error!,
		/取得できません/u,
	);
});

void test("大量の追記後も状態を小さく保ち、取得した出力に欠落や重複がない", async (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	let tool: ToolSummary = {
		id: "stream",
		title: "command",
		kind: "execute",
		status: "in_progress",
		paths: [],
	};
	for (let i = 0; i < 1000; i++) {
		tool = { ...tool };
		setToolOutputSource(tool, { text: `${i}:日本語🐈\n`, delta: true });
		tool = store.project(tool);
		assert.ok(JSON.stringify(tool).length < 3000);
	}
	const result = await store.read({
		type: "tool/output",
		requestId: "read",
		outputRef: tool.output!.outputRef!,
		offset: 0,
		limit: 65536,
	});
	assert.equal(
		result.text,
		Array.from({ length: 1000 }, (_, i) => `${i}:日本語🐈\n`).join(""),
	);
	assert.equal(result.eof, true);
});

void test("全文がある出力は省略文字数を表示し、絵文字を一文字として数える", (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	for (const [id, text, expected] of [
		["ascii", "a".repeat(20420), "… 18,420文字を省略 …"],
		["emoji", "🐈".repeat(1500), "… 500文字を省略 …"],
	]) {
		const output = store.project({
			id: id!,
			title: "command",
			status: "completed",
			paths: [],
			rawOutput: { formatted_output: text },
		}).output!;
		assert.ok(output.preview.includes(expected!));
	}
	const streamed: ToolSummary = {
		id: "streamed-count",
		title: "command",
		status: "in_progress",
		paths: [],
	};
	setToolOutputSource(streamed, { text: "🐈".repeat(600), delta: true });
	store.project(streamed);
	const next = { ...streamed };
	setToolOutputSource(next, { text: "猫".repeat(10000), delta: true });
	assert.ok(
		store.project(next).output!.preview.includes("… 9,200文字を省略 …"),
	);
});

void test("省略済みの出力や全文を読まない外部ファイルでは省略文字数を推測しない", (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	const base: ToolSummary = {
		id: "unknown-count",
		title: "command",
		status: "completed",
		paths: [],
	};
	setToolOutputSource(base, { text: "先頭".repeat(1100), truncated: true });
	assert.ok(store.project(base).output!.preview.includes("… 出力を省略 …"));
	const path = join(
		process.env.NERITA_TEST_ROOT!,
		`output-count-${randomBytes(8).toString("hex")}.log`,
	);
	writeFileSync(path, "猫".repeat(10000), "utf8");
	t.after(() => unlinkSync(path));
	const external = { ...base, id: "external-count" };
	setToolOutputSource(external, { text: "先頭…末尾", path });
	assert.ok(
		store.project(external).output!.preview.includes("… 出力を省略 …"),
	);
});

void test("範囲要求は負数・小数・過大な取得量・任意パスを拒否する", async () => {
	const request = {
		type: "tool/output",
		requestId: "read",
		outputRef: "known",
		offset: 0,
		limit: 65536,
	};
	assert.ok(isUiMessage(request));
	for (const invalid of [
		{ offset: -1 },
		{ offset: 1.5 },
		{ limit: 65537 },
		{ limit: 0 },
		{ limit: 3 },
	]) {
		assert.equal(isUiMessage({ ...request, ...invalid }), false);
	}
	const store = new ToolOutputStore();
	assert.ok(
		(
			await store.read({
				...request,
				type: "tool/output",
				outputRef: "../../unregistered",
			})
		).error,
	);
});

void test("書込み待ちの累積結果を置き換え、追記・破棄後も古い本文を返さない", async (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	const base: ToolSummary = {
		id: "replace",
		title: "command",
		kind: "execute",
		status: "in_progress",
		paths: [],
	};
	const first = { ...base };
	setToolOutputSource(first, { text: "古い本文🐈".repeat(10000) });
	const old = store.project(first);
	const request = {
		type: "tool/output" as const,
		requestId: "read",
		outputRef: old.output!.outputRef!,
		offset: 0,
		limit: 65536,
	};
	const waiting = store.read(request);
	const latest = { ...base };
	setToolOutputSource(latest, { text: "置換後🐈" });
	store.project(latest);
	const delta = { ...base };
	setToolOutputSource(delta, { text: "追記", delta: true });
	store.project(delta);
	assert.equal((await waiting).text, "置換後🐈追記");
	const pending = { ...base };
	setToolOutputSource(pending, { text: "未完了".repeat(10000) });
	store.project(pending);
	const cancelled = store.read(request);
	store.dispose();
	assert.ok((await cancelled).error);
});

void test("Pi の構造化結果から許可された一時出力だけを読み、削除済みと履歴ではパスへ戻らない", async (t) => {
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	const path = join(
		tmpdir(),
		`pi-bash-${randomBytes(8).toString("hex")}.log`,
	);
	writeFileSync(path, "全文の先頭\n省略部分🐈\n末尾のエラー", "utf8");
	t.after(() => {
		try {
			unlinkSync(path);
		} catch {
			/* テスト中に削除済み。 */
		}
	});
	const source = {
		structuredContent: {
			output: "先頭…末尾",
			truncated: true,
			full_output_path: path,
			exit_code: 1,
		},
	};
	const live: ToolSummary = {
		id: "pi",
		title: "bash",
		kind: "execute",
		status: "failed",
		paths: [],
	};
	registerPiOutput(live, "bash", source, false);
	const projected = store.project(live);
	assert.equal(projected.exitCode, 1);
	assert.ok(projected.output?.outputRef);
	assert.ok(!JSON.stringify(projected).includes(path));
	const request = {
		type: "tool/output" as const,
		requestId: "read",
		outputRef: projected.output.outputRef,
		offset: 0,
		limit: 65536,
	};
	assert.equal(
		(await store.read(request)).text,
		"全文の先頭\n省略部分🐈\n末尾のエラー",
	);
	unlinkSync(path);
	assert.ok((await store.read(request)).error);
	const historical = { ...live, id: "history" };
	registerPiOutput(historical, "bash", source, true);
	const restored = store.project(historical);
	assert.equal(restored.output?.outputRef, undefined);
	assert.ok(restored.output?.preview.includes("先頭"));
	const invalid = { ...live, id: "unregistered" };
	registerPiOutput(
		invalid,
		"bash",
		{
			structuredContent: {
				...source.structuredContent,
				full_output_path: join(tmpdir(), "private.txt"),
			},
		},
		false,
	);
	assert.equal(store.project(invalid).output?.outputRef, undefined);
});

void test(
	"Codex の逐次出力を小さい状態で配信し、本文のない終了通知でも最後の出力を読める",
	verifyCodexOutput,
);

/** App Server の通知から UI 取得応答まで、本番の境界を通す。 */
async function verifyCodexOutput(t: TestContext) {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await controller.receive({
		type: "prompt/send",
		requestId: "start-output",
		sessionId: controller.snapshot().sessionId,
		text: "出力を確認",
	});
	const threadId = controller.snapshot().sessionId;
	const turnId = "turn-1";
	f.notify("turn/started", {
		threadId,
		turn: { id: turnId, status: "inProgress", items: [] },
	});
	const item = {
		id: "command",
		type: "commandExecution",
		command: "emit output",
		cwd: f.cwd,
		status: "inProgress",
		aggregatedOutput: null,
		exitCode: null,
	};
	f.notify("item/started", { threadId, turnId, item });
	const text = `先頭\n${"日本語🐈\n".repeat(100000)}末尾エラー`;
	f.notify("item/commandExecution/outputDelta", {
		threadId,
		turnId,
		itemId: item.id,
		delta: text,
	});
	f.notify("item/completed", {
		threadId,
		turnId,
		item: { ...item, status: "failed", exitCode: 1 },
	});
	await until(() =>
		controller
			.snapshot()
			.tools.some(
				(tool) => tool.id === item.id && tool.status === "failed",
			),
	);
	const tool = controller
		.snapshot()
		.tools.find((tool) => tool.id === item.id)!;
	assert.equal(tool.exitCode, 1);
	assert.ok(tool.output?.outputRef);
	assert.ok(JSON.stringify(tool).length < 3000);
	assert.match(tool.output.preview, /末尾エラー$/u);
	let response: ToolOutputResponse | undefined;
	const unsubscribe = controller.subscribe((message) => {
		if (message.type === "tool/outputResult") {
			response = message;
		}
	});
	t.after(unsubscribe);
	await controller.receive({
		type: "tool/output",
		requestId: "tail",
		outputRef: tool.output.outputRef,
		offset: Buffer.byteLength(text) - Buffer.byteLength("末尾エラー"),
		limit: 65536,
	});
	assert.equal(response?.text, "末尾エラー");
	assert.equal(response.eof, true);
}
