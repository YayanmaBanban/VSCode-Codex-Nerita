// 配布 SDK のユーザー・拡張起動と準備中の停止を、実際の起動フックと HTTP 要求で検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { piFixture, send, finished, permission, until } from "../support/pi";

void test("信頼済み拡張が models サブパスを同梱 SDK から読み込み、推論レベルを補正できる", async (t) => {
	const f = await piFixture(t);
	const root = join(f.root, "models-extension");
	await mkdir(root);
	const extension = join(root, "models.mjs");
	await writeFile(
		extension,
		`import { clampThinkingLevel } from '@earendil-works/pi-ai/models';
import { clampThinkingLevel as legacyClamp } from '@mariozechner/pi-ai/models';
export default function (pi) {
 pi.on('before_agent_start', (event, context) => ({
  systemPrompt: event.systemPrompt + '\\nmodels-subpath:' + clampThinkingLevel(context.model, 'high') + ':' + legacyClamp(context.model, 'high'),
 }));
}`,
	);
	await f.trust.setUserTrust(root, true);
	f.options.trustedExtensionPaths = [extension];
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push("拡張の読み込み完了");
	await send(controller, "推論レベルを確認");
	assert.equal((await finished(controller)).run, "completed");
	assert.ok(f.model.requests[0]!.includes("models-subpath:off:off"));
});

void test("Codemode の空き待ちを停止でき、待機中の次の実行は空きができてから承認を要求する", async (t) => {
	const previousLimit = process.env.PI_CODEMODE_MAX_WORKERS;
	process.env.PI_CODEMODE_MAX_WORKERS = "2";
	t.after(() => {
		if (previousLimit === undefined) {
			delete process.env.PI_CODEMODE_MAX_WORKERS;
		} else {
			process.env.PI_CODEMODE_MAX_WORKERS = previousLimit;
		}
	});
	const holders = [];
	for (let i = 0; i < 2; i++) {
		holders.push(await holdCodemodeWorker(t));
	}

	const f = await piFixture(t);
	f.options.codemode = true;
	const waiter = f.controller();
	await waiter.connect();
	for (const cancel of [true, false]) {
		f.model.replies.push({
			name: "codemode",
			arguments: {
				code: "await tools.write({ path: 'waiter.txt', content: 'after-release' });",
			},
		});
		await send(waiter, "ワーカーの空きを待つ");
		await permission(waiter, "accept");
		await until(
			() => waiter.snapshot().tools.at(-1)?.status === "in_progress",
		);
		assert.equal(waiter.snapshot().permissions.length, 0);
		await assert.rejects(readFile(join(f.cwd, "waiter.txt")), {
			code: "ENOENT",
		});
		if (cancel) {
			const state = waiter.snapshot();
			await waiter.receive({
				type: "prompt/cancel",
				requestId: "cancel-worker-wait",
				sessionId: state.sessionId,
				runId: state.runId,
			});
			assert.equal((await finished(waiter)).run, "cancelled");
			continue;
		}

		f.model.replies.push("待機した実行の終了");
		await permission(holders[0]!, "accept");
		assert.equal((await finished(holders[0]!)).run, "completed");
		await permission(waiter, "accept");
		const state = await finished(waiter);
		assert.equal(state.run, "completed", JSON.stringify(state));
		assert.ok(
			state.tools.slice(-2).every((tool) => tool.status === "completed"),
		);
		assert.equal(
			await readFile(join(f.cwd, "waiter.txt"), "utf8"),
			"after-release",
		);
	}
	await permission(holders[1]!, "accept");
	assert.equal((await finished(holders[1]!)).run, "completed");
	assert.equal(
		waiter.snapshot().tools.length,
		3,
		"停止した待機から子を実行しない",
	);
	assert.equal(waiter.snapshot().tools[0]?.status, "cancelled");
});

/** 親だけを許可し、子の書込み承認を保留して実際の Worker を占有する。 */
async function holdCodemodeWorker(t: TestContext) {
	const f = await piFixture(t);
	f.options.codemode = true;
	f.model.replies.push(
		{
			name: "codemode",
			arguments: {
				code: "await tools.write({ path: 'holder.txt', content: 'released' });",
			},
		},
		"保持した実行の終了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "ワーカーを子の承認待ちで保持");
	await permission(controller, "accept");
	await until(() => controller.snapshot().permissions.length === 1);
	return controller;
}

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

for (const [name, withinLimit, overLimit] of [
	["文字数", "text('a'.repeat(32700));", "text('a'.repeat(32769));"],
	[
		"項目数",
		"for (let i = 0; i < 128; i++) text('');",
		"for (let i = 0; i < 129; i++) text('');",
	],
	[
		"console",
		"console.log('a'.repeat(32700));",
		"console.log('a'.repeat(32769));",
	],
	[
		"保存値",
		"store('value', 'a'.repeat(16382));",
		"store('value', 'a'.repeat(16385));",
	],
] as const) {
	void test(`Codemode の${name}上限を SDK 更新後も強制し、失敗後の会話を続けられる`, async (t) => {
		const f = await piFixture(t);
		f.options.codemode = true;
		const controller = f.controller();
		await controller.connect();
		for (const [code, status] of [
			[withinLimit, "completed"],
			[overLimit, "failed"],
		] as const) {
			f.model.replies.push(
				{ name: "codemode", arguments: { code } },
				"制限後の回答",
			);
			await send(controller, "コード実行の上限を確認");
			await permission(controller, "accept");
			const state = await finished(controller);
			assert.equal(state.run, "completed", JSON.stringify(state));
			assert.equal(
				state.tools.at(-1)?.status,
				status,
				JSON.stringify(state.tools),
			);
			assert.equal(state.messages.at(-1)?.text, "制限後の回答");
		}
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
