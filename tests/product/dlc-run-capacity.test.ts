// 実ファイルと Host の確定記録を使い、JSON 化後の容量上限と新しい `IntentRepository` からの復元を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "@nerita/shared/chatState";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { freezeKnowledge } from "../../apps/vscode-nerita/src/extension/dlc/FrozenKnowledge";
import type { AuthorityRecord } from "../../apps/vscode-nerita/src/extension/dlc/IntentAuthority";
import { dlcWorkspace } from "../support/dlcWorkspace";
import { createTestIntent, plannedIntent, testIntentId } from "../support/dlc";

void test("エスケープ・日本語・整形を含む JSON 全体の容量が16 MiB なら保存し、1バイト超過は未確定のまま拒否する", async (t) => {
	const f = await dlcWorkspace(t);
	const context = await prepareContext(f);
	await f.repository.freezeRun(context);
	await f.repository.freezeRun({
		...context,
		request: { ...context.request, attemptId: "oversize" },
	});
	const conversation = initialState();
	const prefix = '"\\\u0000\n日本語🐈';
	conversation.tools.push({
		id: "output",
		title: "出力",
		status: "completed",
		paths: [],
		rawOutput: prefix,
	});
	const size = () =>
		Buffer.byteLength(`${JSON.stringify(conversation, null, 2)}\n`, "utf8");
	const limit = 16 * 1024 * 1024;
	const text = prefix + "x".repeat(limit - size());
	conversation.tools[0]!.rawOutput = text;
	assert.equal(size(), limit);
	// 8 MiB を超える未確定ファイルも、Host 側の保存失敗の原因を解消した後に同じ全文で確定できる。
	const write = f.authority.write.bind(f.authority);
	let fail = true;
	const fault = t.mock.method(
		f.authority,
		"write",
		(key: string, value: AuthorityRecord) => {
			if (fail && key.startsWith("dlc.run.")) {
				return Promise.reject(new Error("確定記録の保存故障"));
			}
			return write(key, value);
		},
	);
	await assert.rejects(
		f.repository.saveConversation(testIntentId, "boundary", conversation),
		/保存故障/,
	);
	assert.equal(f.repository.hasConversation(testIntentId, "boundary"), false);
	fail = false;
	await f.repository.saveConversation(testIntentId, "boundary", conversation);
	fault.mock.restore();
	const reopened = new IntentRepository(f.files, f.authority, f.files);
	assert.deepEqual(
		await reopened.conversation(testIntentId, "boundary"),
		conversation,
	);
	conversation.tools[0]!.rawOutput = `${text}x`;
	assert.equal(size(), limit + 1);
	await assert.rejects(
		reopened.saveConversation(testIntentId, "oversize", conversation),
		/保存上限/,
	);
	assert.equal(reopened.hasConversation(testIntentId, "oversize"), false);
	assert.equal(
		(await reopened.runContext(testIntentId, "oversize")).prompt,
		context.prompt,
	);
	conversation.tools[0]!.rawOutput = "\\".repeat(9 * 1024 * 1024);
	assert.ok(size() > limit);
	await assert.rejects(
		reopened.saveConversation(testIntentId, "oversize", conversation),
		/保存上限/,
	);
	assert.equal(reopened.hasConversation(testIntentId, "oversize"), false);
});

/** 有効な Intent と送信前の入力を、実際の保存処理で準備する。 */
async function prepareContext(f: Awaited<ReturnType<typeof dlcWorkspace>>) {
	await f.detection();
	await f.repository.import(createTestIntent());
	const directory = await f.repository.directory(testIntentId);
	const knowledge = await freezeKnowledge(
		f.files,
		directory,
		new AbortController().signal,
	);
	const task = plannedIntent().workItems[0]!;
	return {
		schemaVersion: 1 as const,
		request: {
			title: task.title,
			instructions: task.instructions,
			paths: task.paths,
			intentId: testIntentId,
			request: "要求",
			workItemId: task.id,
			attemptId: "boundary",
			continuity: "fresh" as const,
			policy: "workspace-inherit" as const,
		},
		backend: "pi" as const,
		executionDirectory: f.root,
		prompt: "実際に送信する全文",
		knowledge,
	};
}
