// 配布 SDK のユーザー・拡張起動と準備中の停止を、実際の起動フックと HTTP 要求で検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { piFixture, send, finished, permission } from "../support/pi";

void test("拡張起動も起動フックを通り、準備中のメッセージを二重起動せず同じ実行へ届ける", async (t) => {
	const f = await piFixture(t);
	await startExtension(
		f,
		`
 pi.on('before_agent_start', async (event, context) => {
  await appendFile(new URL('./starts.txt', import.meta.url), event.messageType + ':' + context.isIdle() + '\\n');
  if (event.messageType === 'custom') {
   pi.sendMessage({ customType: 'queued', content: '起動準備中の追加情報', display: false }, { triggerTurn: true });
  }
  return { systemPrompt: event.systemPrompt + '\\n起動フックのシステム指示' };
 });`,
	);
	const sessionSchema = z.custom<
		Pick<AgentSession, "sendCustomMessage" | "waitForIdle">
	>(
		(value) =>
			isRecord(value) &&
			typeof value.sendCustomMessage === "function" &&
			typeof value.waitForIdle === "function",
	);
	let session: z.infer<typeof sessionSchema> | undefined;
	const controller = f.controller((runtime) => {
		session = sessionSchema.parse(runtime);
	});
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		JSON.stringify(controller.snapshot()),
	);
	f.model.replies.push("ユーザー起動の回答");
	await send(controller, "通常の送信");
	assert.equal((await finished(controller)).run, "completed");
	assert.ok(session);
	f.model.replies.push("拡張起動の回答");
	await session.sendCustomMessage(
		{ customType: "start", content: "拡張からの開始情報", display: false },
		{ triggerTurn: true },
	);
	await session.waitForIdle();

	assert.equal(
		f.model.requests.length,
		2,
		"準備中のメッセージで別の実行を始めない",
	);
	assert.ok(f.model.requests[1]!.includes("拡張からの開始情報"));
	assert.ok(f.model.requests[1]!.includes("起動準備中の追加情報"));
	assert.ok(f.model.requests[1]!.includes("起動フックのシステム指示"));
	assert.equal(
		await readFile(join(f.root, "start-extension", "starts.txt"), "utf8"),
		"user:false\ncustom:false\n",
	);
});

void test("起動フック中の停止を cancelled として確定し、次の送信を再開できる", async (t) => {
	const f = await piFixture(t);
	await startExtension(
		f,
		`
 pi.on('before_agent_start', (event, context) => {
  if (event.messageType === 'user' && event.prompt === '準備中に停止') void context.abort();
 });`,
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "準備中に停止");
	const stopped = await finished(controller);
	assert.equal(stopped.run, "cancelled", JSON.stringify(stopped));
	assert.equal(f.model.requests.length, 0);

	f.model.replies.push("再開した回答");
	await send(controller, "次の送信");
	const next = await finished(controller);
	assert.equal(next.run, "completed", JSON.stringify(next));
	assert.equal(next.messages.at(-1)?.text, "再開した回答");
});

for (const [name, code] of [
	["文字数", "text('a'.repeat(32769));"],
	["項目数", "for (let i = 0; i < 129; i++) text('');"],
	["console", "console.log('a'.repeat(32769));"],
	["保存値", "store('value', 'a'.repeat(16385));"],
] as const) {
	void test(`Codemode の${name}上限を SDK 更新後も強制し、失敗後の会話を続けられる`, async (t) => {
		const f = await piFixture(t);
		f.options.codemode = true;
		const controller = f.controller();
		await controller.connect();
		f.model.replies.push(
			{ name: "codemode", arguments: { code } },
			"制限後の回答",
		);
		await send(controller, "コード実行の上限を確認");
		await permission(controller, "accept");
		const state = await finished(controller);
		assert.equal(state.run, "completed", JSON.stringify(state));
		assert.equal(
			state.tools[0]?.status,
			"failed",
			JSON.stringify(state.tools),
		);
		assert.match(
			state.tools[0].output!.preview,
			/(?:script output exceeded|store\("value"\).*more than the limit)/u,
		);
		assert.equal(state.messages.at(-1)?.text, "制限後の回答");
	});
}

/** 信頼を明示した一時拡張だけをロードし、ユーザーの拡張設定へ書き込まない。 */
async function startExtension(
	f: Awaited<ReturnType<typeof piFixture>>,
	body: string,
) {
	const root = join(f.root, "start-extension");
	await mkdir(root);
	const extension = join(root, "start.mjs");
	await writeFile(
		extension,
		`import { appendFile } from 'node:fs/promises';
export default function (pi) { ${body} }`,
	);
	await f.trust.setUserTrust(root, true);
	f.options.trustedExtensionPaths = [extension];
}
