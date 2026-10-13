// 送信された参照の保存・別接続の復元と、UTF-8 の位置および破損データの扱いを検証する。
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import {
	pathText,
	type ComposerReference,
} from "@nerita/shared/composerReferences";
import type { ComposerTarget } from "@nerita/shared/composerTargets";
import type { HostMessage } from "@nerita/shared/messages";
import { codexFixture } from "../support/codex";
import {
	piFixture,
	finished,
	until,
	permission,
	sessionFiles,
} from "../support/pi";
import { restoredState } from "../support/restoredState";
import {
	referenceElements,
	restoreReferenceElements,
} from "@/extension/backends/codex/history/referenceElements";

const range = {
	start: { line: 2, character: 1 },
	end: { line: 4, character: 7 },
};
const targets: ComposerTarget[] = [
	{
		kind: "file",
		uri: "fixture:src/素材.ts",
		path: "src/素材.ts",
		name: "素材.ts",
		range,
	},
	{
		kind: "file",
		uri: "fixture:src/main.ts",
		path: "src/main.ts",
		name: "関数🐈",
		symbol: { kind: 11, range },
	},
	{ kind: "directory", uri: "fixture:src", path: "src", name: "src" },
	{
		kind: "session",
		mode: "transcript",
		sessionId: "source",
		name: "会話🐈",
		cwd: "workspace",
	},
	{ kind: "changes", scope: "staged", name: "Staged" },
];
const text = `日本語🐈\n\`\`\`\ncode\n\`\`\`\n${targets.map(pathText).join("\n")}\n後文`;
let cursor = 0;
const references: ComposerReference[] = targets.map((path) => {
	const offset = text.indexOf(pathText(path), cursor);
	cursor = offset + pathText(path).length;
	return { offset, path };
});

const textInputSchema = z.array(
	z.object({
		type: z.literal("text"),
		text: z.string(),
		text_elements: z.array(z.unknown()),
	}),
);

void test("Codex の UTF-8 範囲を復元し、破損・未知・重複要素を参照にせず本文を保持する", () => {
	const elements = referenceElements(text, references);
	assert.equal(elements[0]!.byteRange.start, 27);
	assert.deepEqual(restoreReferenceElements(text, elements), references);
	const first = elements[0]!;
	const invalid = [
		{ ...first, placeholder: "not-json" },
		{
			...first,
			placeholder: JSON.stringify({
				type: "other",
				version: 1,
				target: targets[0],
			}),
		},
		{
			...first,
			placeholder: JSON.stringify({
				type: "nerita.reference",
				version: 2,
				target: targets[0],
			}),
		},
		{
			...first,
			placeholder: JSON.stringify({
				type: "nerita.reference",
				version: 1,
				target: { kind: "file" },
			}),
		},
		{ ...first, byteRange: { start: 1, end: first.byteRange.end } },
		{ ...first, byteRange: { start: -1, end: first.byteRange.end } },
		{ ...first, byteRange: { start: 0, end: text.length * 10 } },
		{ ...first, byteRange: { start: 0, end: 3 } },
		null,
	];
	assert.deepEqual(restoreReferenceElements(text, invalid), []);
	assert.deepEqual(
		restoreReferenceElements(text, [
			...invalid,
			...elements.slice().reverse(),
			first,
		]),
		references,
	);
});

for (const historyMode of ["legacy", "paginated"] as const) {
	void test(`Codex の通常送信・追加指示のチップを ${historyMode} 履歴から別接続で復元する`, (t) =>
		verifyCodexReferences(t, historyMode));
}

void test("Codex の Goal 接頭辞を付けた本文でもチップ位置を保持して履歴から復元する", (t) =>
	verifyCodexReferences(t, "paginated", true));

/** JSONL 通信を通った要素を、別のコントローラーの履歴入力として返す。 */
async function verifyCodexReferences(
	t: TestContext,
	historyMode: "legacy" | "paginated",
	goal = false,
) {
	const f = await codexFixture(t);
	const controller = f.controller();
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	const threadId = controller.snapshot().sessionId!;
	if (goal) {
		await controller.receive({
			type: "config/set",
			requestId: "goal",
			sessionId: threadId,
			configId: "collaboration_mode",
			value: "goal",
		});
	}
	const expectedText = goal ? `/goal ${text}` : text;
	const expectedReferences = goal
		? references.map((reference) => ({
				...reference,
				offset: reference.offset + 6,
			}))
		: references;
	await sendCodexReferences(controller, events, threadId, "first");
	f.notify("turn/started", {
		threadId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	await sendCodexReferences(controller, events, threadId, "steer");
	const sent = f.requests.filter((request) =>
		["turn/start", "turn/steer"].includes(request.method),
	);
	assert.deepEqual(
		sent.map((request) => request.method),
		["turn/start", "turn/steer"],
	);
	const content = sent.map((request) =>
		textInputSchema.parse(request.params!.input),
	);
	for (const input of content) {
		assert.equal(input[0]!.text, expectedText);
		assert.deepEqual(
			restoreReferenceElements(input[0]!.text, input[0]!.text_elements),
			expectedReferences,
		);
	}
	await controller.dispose();
	await verifyReopenedCodex(
		f,
		threadId,
		historyMode,
		content,
		expectedText,
		expectedReferences,
	);
}

/** 送信の受付と画面の実行状態を区別し、要求 ID に対応する受付通知を待つ。 */
async function sendCodexReferences(
	controller: ReturnType<
		Awaited<ReturnType<typeof codexFixture>>["controller"]
	>,
	events: HostMessage[],
	sessionId: string,
	requestId: string,
) {
	await controller.receive({
		type: "prompt/send",
		requestId,
		sessionId,
		text,
		references,
	});
	await until(
		() =>
			events.some(
				(event) =>
					event.type === "prompt/accepted" &&
					event.requestId === requestId,
			),
		() => events.filter((event) => event.type === "request/failed"),
	);
}

/** 元のコントローラーを破棄し、履歴の公開状態だけから参照を確認する。 */
async function verifyReopenedCodex(
	f: Awaited<ReturnType<typeof codexFixture>>,
	threadId: string,
	historyMode: "legacy" | "paginated",
	content: { type: "text"; text: string; text_elements: unknown[] }[][],
	expectedText: string,
	expectedReferences: ComposerReference[],
) {
	configureCodexHistory(f, threadId, historyMode, content);
	const reopened = f.controller();
	await reopened.connect();
	await reopened.receive({ type: "session/list", requestId: "list" });
	await reopened.receive({
		type: "session/load",
		requestId: "load",
		sessionId: threadId,
	});
	assert.equal(reopened.snapshot().sessionsError, null);
	assert.deepEqual(
		reopened.snapshot().messages.map((message) => ({
			text: message.text,
			references: message.references,
		})),
		[
			{ text: expectedText, references: expectedReferences },
			{ text: expectedText, references: expectedReferences },
		],
	);
}

/** 旧形式とページ形式の応答だけを差し替え、復元処理は製品経路を使う。 */
function configureCodexHistory(
	f: Awaited<ReturnType<typeof codexFixture>>,
	threadId: string,
	historyMode: "legacy" | "paginated",
	content: { type: "text"; text: string; text_elements: unknown[] }[][],
) {
	const items = content.map((input, index) => ({
		type: "userMessage",
		id: `user-${index}`,
		content: input,
	}));
	const turns = [
		{
			id: "saved-turn",
			status: "completed",
			itemsView: historyMode === "legacy" ? "full" : "summary",
			items: historyMode === "legacy" ? items : [],
		},
	];
	const thread = {
		id: threadId,
		cwd: f.cwd,
		name: null,
		preview: "参照履歴",
		updatedAt: 1,
		status: { type: "idle" },
		historyMode,
		turns: historyMode === "legacy" ? turns : [],
	};
	f.responses.set("thread/list", () => ({
		data: [thread],
		nextCursor: null,
	}));
	f.responses.set("thread/read", () => ({ thread }));
	f.responses.set("thread/resume", () => ({
		thread,
		model: "model-a",
		cwd: f.cwd,
	}));
	f.responses.set("thread/turns/list", () => ({
		data: turns,
		nextCursor: null,
	}));
	f.responses.set("thread/items/list", () => ({
		data: items.map((item) => ({ turnId: "saved-turn", item })),
		nextCursor: null,
	}));
}

void test("Pi の同じ本文の通常送信・キュー入力を SDK 本体で保存し、別プロセスとフォークでチップを復元する", async (t) => {
	const f = await piFixture(t);
	f.model.replies.push(
		{ name: "write", arguments: { path: "hold.txt", content: "hold" } },
		"回答",
		"分岐回答",
	);
	const controller = f.controller();
	await controller.connect();
	const sessionId = controller.snapshot().sessionId!;
	await controller.receive({
		type: "prompt/send",
		requestId: "first",
		sessionId,
		text,
		references,
	});
	await until(() => controller.snapshot().permissions.length > 0);
	// 同じ表示本文でも、参照先 URI が異なる2件を親 ID で区別する。
	const second = references.map((reference) => ({
		...reference,
		path:
			reference.path.kind === "file"
				? { ...reference.path, uri: `${reference.path.uri}?second` }
				: reference.path,
	}));
	await controller.receive({
		type: "prompt/send",
		requestId: "steer",
		sessionId,
		text,
		references: second,
	});
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.run, "completed", JSON.stringify(state));
	await controller.dispose();
	const restored = await restoredState(f, sessionId);
	assert.deepEqual(
		restored.messages
			.filter((message) => message.role === "user")
			.map((message) => ({
				text: message.text,
				references: message.references,
			})),
		[
			{ text, references },
			{ text, references: second },
		],
	);
	const saved = await sessionFiles(f.cwd);
	assert.ok(saved[0]!.text.includes('"customType":"nerita.references.v1"'));
	assert.ok(
		!f.model.requests.some((request) =>
			request.includes("nerita.references.v1"),
		),
	);
	const reopened = f.controller();
	await reopened.connect();
	await reopened.receive({ type: "session/list", requestId: "list" });
	await reopened.receive({
		type: "session/fork",
		requestId: "fork",
		sessionId,
	});
	assert.notEqual(reopened.snapshot().sessionId, sessionId);
	assert.deepEqual(
		reopened
			.snapshot()
			.messages.filter((message) => message.role === "user")
			.map((message) => message.references),
		[references, second],
	);
});

void test("Pi の破損した参照レコードをチップにせず、保存済みの本文を別プロセスで保持する", async (t) => {
	const f = await piFixture(t);
	f.model.replies.push("回答");
	const controller = f.controller();
	await controller.connect();
	const sessionId = controller.snapshot().sessionId!;
	await controller.receive({
		type: "prompt/send",
		requestId: "send",
		sessionId,
		text,
		references,
	});
	assert.equal((await finished(controller)).run, "completed");
	await controller.dispose();
	const [saved] = await sessionFiles(f.cwd);
	assert.ok(saved);
	const corrupted = saved.text
		.split("\n")
		.map((line) => {
			if (!line.includes('"customType":"nerita.references.v1"')) {
				return line;
			}
			return line.replace('"offset":19', '"offset":20');
		})
		.join("\n");
	assert.notEqual(corrupted, saved.text);
	await writeFile(saved.path, corrupted);
	const restored = await restoredState(f, sessionId);
	const user = restored.messages.find((message) => message.role === "user")!;
	assert.equal(user.text, text);
	assert.equal(user.references, undefined);
});
