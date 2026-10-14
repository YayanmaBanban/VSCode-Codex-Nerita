// 両バックエンドが公開した質問へ通信経由で回答し、停止・取り消し・不正入力時の動作を検証する。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { QuestionRequest } from "@nerita/shared/questions";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { BackendSession } from "../../apps/vscode-nerita/src/extension/session/chatSession";
import { codexFixture } from "../support/codex";
import { piFixture, send, finished, until } from "../support/pi";

/** UI と同じ返信先を使い、通常の `prompt/send` は発行しない。 */
async function answer(
	controller: BackendSession,
	question: QuestionRequest,
	answers: Record<string, string>,
	action = "accept",
) {
	await controller.receive({
		type: "question/respond",
		requestId: randomUUID(),
		questionId: question.id,
		sessionId: question.sessionId,
		runId: question.runId,
		action,
		answers,
	});
}

/** 元の JSONL 要求の応答を待ち、通信失敗を入力結果と区別する。 */
async function codexReply(
	f: Awaited<ReturnType<typeof codexFixture>>,
	id: number,
): Promise<unknown> {
	await until(() => f.clientResponses.some((response) => response.id === id));
	const response = f.clientResponses.find((entry) => entry.id === id)!;
	assert.equal(response.error, undefined);
	return response.result;
}

void test("Codexの複数質問は説明・自由回答・秘密入力を保持し、古い回答を受け付けない", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		text: "方針を確認する",
	});
	const requestId = f.serverRequest("item/tool/requestUserInput", {
		threadId: controller.snapshot().sessionId,
		turnId: "turn-1",
		itemId: "question",
		questions: [
			{
				id: "choice",
				header: "実装方針",
				question: "方式を選んでください",
				isOther: true,
				options: [
					{ label: "方式A", description: "既存の構成を使います" },
				],
			},
			{
				id: "secret",
				question: "確認コード",
				isSecret: true,
				options: null,
			},
		],
	});
	await until(() => controller.snapshot().questions.length === 1);
	const question = controller.snapshot().questions[0]!;
	assert.equal(
		question.fields[0]?.options?.[0]?.description,
		"既存の構成を使います",
	);
	assert.equal(question.fields[1]?.secret, true);
	await answer(
		controller,
		{ ...question, runId: "stale-run" },
		{ choice: "方式A", secret: "secret-answer" },
	);
	assert.equal(controller.snapshot().questions.length, 1);
	assert.equal(
		f.clientResponses.some((response) => response.id === requestId),
		false,
	);
	await answer(controller, question, {
		choice: "別の方式",
		secret: "secret-answer",
	});
	assert.deepEqual(await codexReply(f, requestId), {
		answers: {
			choice: { answers: ["別の方式"] },
			secret: { answers: ["secret-answer"] },
		},
	});
	assert.equal(controller.snapshot().questions.length, 0);
	assert.equal(
		JSON.stringify(controller.snapshot()).includes("secret-answer"),
		false,
	);
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		1,
	);
});

for (const action of ["accept", "decline", "cancel"]) {
	void test(`CodexのMCPフォームは型・範囲・省略を検証し、${action}を元の要求へ返す`, async (t) => {
		const f = await codexFixture(t);
		const controller = f.controller();
		await controller.connect();
		await controller.receive({
			type: "prompt/send",
			requestId: randomUUID(),
			sessionId: controller.snapshot().sessionId,
			text: "MCPに入力する",
		});
		const requestId = f.serverRequest("mcpServer/elicitation/request", {
			threadId: controller.snapshot().sessionId,
			turnId: "turn-1",
			serverName: "example",
			message: "入力してください",
			mode: "form",
			requestedSchema: {
				type: "object",
				required: ["count", "confirmed"],
				properties: {
					count: { type: "integer", minimum: 1, maximum: 4 },
					confirmed: { type: "boolean" },
					note: { type: "string" },
				},
			},
		});
		await until(() => controller.snapshot().questions.length === 1);
		const question = controller.snapshot().questions[0]!;
		assert.equal(question.source, "MCP");
		await answer(controller, question, {
			count: "1.5",
			confirmed: "unknown",
		});
		assert.ok(isNonEmptyString(controller.snapshot().questions[0]?.error));
		assert.equal(
			f.clientResponses.some((response) => response.id === requestId),
			false,
		);
		await answer(
			controller,
			question,
			{ count: "3", confirmed: "true", note: "" },
			action,
		);
		assert.deepEqual(await codexReply(f, requestId), {
			action,
			content: action === "accept" ? { count: 3, confirmed: true } : null,
			_meta: null,
		});
	});
}

void test("Piのモデルが質問ツールを呼び、回答後に同じ実行を続ける", async (t) => {
	const f = await piFixture(t);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push(
		{
			name: "request_user_input",
			arguments: {
				title: "方針の確認",
				questions: [
					{
						id: "method",
						title: "方式を選んでください",
						required: true,
						options: [
							{ label: "方式A", description: "既存構成" },
							{ label: "方式B" },
						],
					},
				],
			},
		},
		"選択を反映しました",
	);
	await send(controller, "実装を始める前に確認");
	await until(
		() => controller.snapshot().questions.length === 1,
		() => controller.snapshot(),
	);
	const runId = controller.snapshot().runId;
	const question = controller.snapshot().questions[0]!;
	await answer(controller, question, { method: "unknown" });
	assert.ok(isNonEmptyString(controller.snapshot().questions[0]?.error));
	await answer(controller, question, { method: "方式B" });
	const state = await finished(controller);
	assert.equal(state.run, "completed", JSON.stringify(state));
	assert.equal(state.runId, runId);
	assert.equal(state.questions.length, 0);
	assert.equal(state.messages.at(-1)?.text, "選択を反映しました");
	assert.equal(f.model.requests.at(-1)?.includes("方式B"), true);
});

void test("MCPのURL入力は承諾するまで開かず、完了確認と拒否を元の要求へ返す", async (t) => {
	const f = await codexFixture(t);
	const opened: string[] = [];
	const controller = f.controller(undefined, undefined, {
		input: () => {
			assert.fail("入力ダイアログは使用しません。");
		},
		choose: () => {
			assert.fail("選択ダイアログは使用しません。");
		},
		open: (url) => {
			opened.push(url);
			return Promise.resolve();
		},
	});
	await controller.connect();
	await controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		text: "ブラウザー入力",
	});
	const request = (url: string) =>
		f.serverRequest("mcpServer/elicitation/request", {
			threadId: controller.snapshot().sessionId,
			turnId: "turn-1",
			serverName: "example",
			message: "入力を完了してください",
			mode: "url",
			url,
		});
	const id = request("https://example.com/input");
	await until(() => controller.snapshot().questions.length === 1);
	assert.deepEqual(opened, []);
	assert.equal(controller.snapshot().questions[0]?.source, "MCP");
	await answer(controller, controller.snapshot().questions[0]!, {
		open: "ブラウザーで開く",
	});
	await until(
		() => controller.snapshot().questions[0]?.fields[0]?.id === "done",
	);
	assert.deepEqual(opened, ["https://example.com/input"]);
	await answer(controller, controller.snapshot().questions[0]!, {
		done: "入力を完了した",
	});
	assert.deepEqual(await codexReply(f, id), {
		action: "accept",
		content: null,
		_meta: null,
	});
	const declined = request("https://example.com/decline");
	await until(() => controller.snapshot().questions.length === 1);
	await answer(
		controller,
		controller.snapshot().questions[0]!,
		{},
		"decline",
	);
	assert.deepEqual(await codexReply(f, declined), {
		action: "decline",
		content: null,
		_meta: null,
	});
	const blocked = request("http://example.com/unsafe");
	assert.deepEqual(await codexReply(f, blocked), {
		action: "decline",
		content: null,
		_meta: null,
	});
	assert.equal(controller.snapshot().questions.length, 0);
	assert.equal(opened.length, 1);
});

void test("Piの接続時の質問にも回答でき、標準ダイアログのタイムアウトで待機を解放する", async (t) => {
	const f = await piFixture(t);
	await questionExtension(
		f,
		`pi.on('session_start', async (_, ctx) => { await ctx.ui.select('起動時の選択', ['続ける']); }); pi.on('before_agent_start', async (_, ctx) => { await ctx.ui.input('期限付きの質問', undefined, { timeout: 50 }); });`,
	);
	const controller = f.controller();
	const connecting = controller.connect();
	await until(() => controller.snapshot().questions.length === 1);
	const question = controller.snapshot().questions[0]!;
	assert.equal(question.runId, null);
	await answer(controller, question, { answer: "続ける" });
	await connecting;
	assert.equal(controller.snapshot().connection, "ready");
	f.model.replies.push("期限後に続行");
	await send(controller, "タイムアウトを確認");
	await until(() => controller.snapshot().questions.length === 1);
	assert.equal((await finished(controller)).run, "completed");
	assert.equal(controller.snapshot().questions.length, 0);
});

/** 標準ダイアログを呼ぶ検証用 SDK 拡張を作成し、信頼済みの読み込み先に登録する。 */
async function questionExtension(
	f: Awaited<ReturnType<typeof piFixture>>,
	code: string,
) {
	const directory = join(f.root, "question-extension");
	await mkdir(directory);
	const path = join(directory, "index.js");
	await writeFile(path, `export default function(pi) { ${code} }`);
	f.options.trustedExtensionPaths = [path];
	await f.trust.setUserTrust(directory, true);
}

void test("Piのselect・confirm・input・editorは標準SDKから共通カードを使う", async (t) => {
	const f = await piFixture(t);
	await questionExtension(
		f,
		`pi.on('before_agent_start', async (_, ctx) => {
		if (!ctx.hasUI) throw new Error('UI unavailable');
		const values = [];
		values.push(await ctx.ui.select('選択', ['A', 'B']));
		values.push(await ctx.ui.confirm('確認', '続けますか'));
		values.push(await ctx.ui.input('入力', '補足してください'));
		values.push(await ctx.ui.editor('長文', '初期値'));
		return { systemPrompt: JSON.stringify(values) };
	});`,
	);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push("ダイアログ完了");
	await send(controller, "標準質問");
	for (const [title, value] of [
		["選択", "B"],
		["確認", "はい"],
		["入力", "補足"],
		["長文", "一行目\n二行目"],
	]) {
		await until(
			() => controller.snapshot().questions[0]?.title === title,
			() => controller.snapshot(),
		);
		await answer(controller, controller.snapshot().questions[0]!, {
			answer: value!,
		});
	}
	assert.equal((await finished(controller)).run, "completed");
	assert.equal(f.model.requests[0]?.includes("二行目"), true);
});

void test("Piの質問待機中の停止でカードを消し、後からの回答で再開しない", async (t) => {
	const f = await piFixture(t);
	await questionExtension(
		f,
		`pi.on('before_agent_start', async (_, ctx) => { await ctx.ui.input('停止する質問'); });`,
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "質問中に停止");
	await until(() => controller.snapshot().questions.length === 1);
	const question = controller.snapshot().questions[0]!;
	await controller.receive({
		type: "prompt/cancel",
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
	});
	assert.equal((await finished(controller)).run, "cancelled");
	await answer(controller, question, { answer: "古い回答" });
	assert.equal(controller.snapshot().questions.length, 0);
	assert.equal(f.model.requests.length, 0);
});
