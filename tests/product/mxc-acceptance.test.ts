// MXC 本体と Pi の公開操作を通し、通常・子・Codemode の同じ OS 境界と出力保存を確認する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
	piFixture,
	send,
	permission,
	finished,
	until,
	sessionFiles,
} from "../support/pi";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";

for (const route of ["normal", "child", "codemode"] as const) {
	for (const network of [false, true]) {
		if (route === "child" && network) {
			continue;
		}
		void test(`MXC のアクセス境界と DNS ポリシーを継承する（${route} / network=${network}）`, (t) =>
			verifyBoundaries(t, route, network));
	}
}

for (const route of ["normal", "child", "codemode"] as const) {
	for (const stop of ["control", "cancel", "timeout"] as const) {
		if (stop === "control" && route !== "normal") {
			continue;
		}
		void test(`途中出力中の停止で MXC の子孫も終了する（${route} / ${stop}）`, (t) =>
			verifyStop(t, route, stop));
	}
}

/** 実際に Node の子孫を起動してから停止し、遅延書込みが残らないことを確認する。 */
async function verifyStop(t: TestContext, route: string, stop: string) {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	await writeFile(
		join(f.cwd, "descendant.cjs"),
		"setTimeout(() => require('node:fs').writeFileSync('late.txt', 'forbidden'), 4000);",
	);
	await writeFile(
		join(f.cwd, "stream.cjs"),
		"const fs = require('node:fs'); const child = require('node:child_process').spawn(process.execPath, ['descendant.cjs'], {stdio:'ignore'}); const output = setInterval(() => {console.log('STREAM:'+'x'.repeat(1024)); console.error('ERROR_STREAM:'+'y'.repeat(1024));}, 20); fs.writeFileSync('ready.txt', 'started'); child.once('exit', () => {clearInterval(output); process.exit();});",
	);
	await queueExecution(
		f,
		route,
		"node stream.cjs",
		stop === "timeout" ? 2 : 60,
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "出力中に停止する");
	if (route !== "normal") {
		await permission(controller, "accept");
	}
	await permission(controller, "accept");
	await until(() => existsSync(join(f.cwd, "ready.txt")));
	assert.equal(await readFile(join(f.cwd, "ready.txt"), "utf8"), "started");
	if (stop === "cancel") {
		await setTimeout(100);
		const state = controller.snapshot();
		await controller.receive({
			type: "prompt/cancel",
			requestId: "stop",
			sessionId: state.sessionId,
			runId: state.runId,
		});
	}
	const result = await finished(controller);
	if (stop === "control") {
		assert.equal(
			await readFile(join(f.cwd, "late.txt"), "utf8"),
			"forbidden",
		);
		return;
	}
	if (stop === "timeout" && route !== "child") {
		assert.ok(
			JSON.stringify(result.tools).includes("タイムアウト"),
			JSON.stringify(result.tools),
		);
	}
	await setTimeout(4200);
	await assert.rejects(readFile(join(f.cwd, "late.txt")), { code: "ENOENT" });
}

/** 子と Codemode も MXC 本体で拒否される条件を実行し、モデルへ Host のデータが漏れない。 */
async function verifyBoundaries(
	t: TestContext,
	route: string,
	network: boolean,
) {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	const cwd = await realpath(f.cwd);
	if (route !== "child") {
		f.options.parentPolicy = {
			workspaceRoots: [cwd],
			writableRoots: [cwd],
			shell: true,
			networkAccess: network,
		};
	}
	await writeFile(
		join(cwd, "probe.cjs"),
		`const fs = require('node:fs'); const dns = require('node:dns'); let writeDenied = false;
fs.writeFileSync('inside.txt', 'inside'); console.log('WORKSPACE_OK');
try { fs.writeFileSync('../escaped.txt', 'forbidden'); console.log('ESCAPED_WRITE'); } catch { writeDenied = true; console.log('WRITE_DENIED'); }
const timer = setTimeout(() => { console.log('DNS_TIMEOUT'); process.exit(4); }, 5000);
dns.lookup('example.com', (error) => { clearTimeout(timer); const dns = error ? 'DNS_BLOCKED' : 'DNS_OK'; console.log(dns); fs.writeFileSync('probe-result.json', JSON.stringify({ writeDenied, dns })); });`,
	);
	await queueExecution(f, route, "node probe.cjs");
	const controller = f.controller();
	await controller.connect();
	await send(controller, "アクセス境界を確認");
	if (route !== "normal") {
		await permission(controller, "accept");
	}
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null, JSON.stringify(state.tools));
	if (route === "child") {
		await assertChildCommand(controller);
	}
	const observed = JSON.parse(
		await readFile(join(cwd, "probe-result.json"), "utf8"),
	) as unknown;
	assert.deepEqual(observed, {
		writeDenied: true,
		dns: network ? "DNS_OK" : "DNS_BLOCKED",
	});
	assert.equal(await readFile(join(cwd, "inside.txt"), "utf8"), "inside");
	await assert.rejects(readFile(join(f.root, "escaped.txt")), {
		code: "ENOENT",
	});
	if (route === "child") {
		assert.equal(state.agents[0]!.status, "completed");
	}
}

void test("MXC の大量 stdout/stderr は逐次プレビューと保存後の範囲取得を保つ", async (t) => {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	await writeFile(
		join(f.cwd, "output.cjs"),
		"console.log('OUTPUT_STARTED'); setTimeout(() => { for(let i=0;i<2048;i++){process.stdout.write('OUT:'+'x'.repeat(1024)+'\\n'); process.stderr.write('ERR:'+'y'.repeat(1024)+'\\n');} console.log('OUTPUT_END'); process.exitCode=7; }, 250);",
	);
	await queueExecution(f, "normal", "node output.cjs; exit $LASTEXITCODE");
	const controller = f.controller();
	await controller.connect();
	await send(controller, "大量出力を確認");
	await permission(controller, "accept");
	await until(
		() => hasOutput(controller.snapshot().tools, "OUTPUT_STARTED"),
		() => controller.snapshot().tools,
	);
	const state = await finished(controller);
	const tool = state.tools[0]!;
	assert.equal(tool.exitCode, 7, JSON.stringify(tool.output));
	assert.equal(tool.output!.truncated, true);
	assert.ok(tool.output!.preview.length < 30000);
	assert.ok(tool.output!.outputRef);
	const files = await sessionFiles(f.cwd);
	assert.ok(files[0]!.text.includes("OUTPUT_END"));
	const replies: unknown[] = [];
	const unsubscribe = controller.subscribe((reply) => replies.push(reply));
	await controller.receive({
		type: "tool/output",
		requestId: "output-range",
		outputRef: tool.output!.outputRef,
		offset: 0,
		limit: 1000,
	});
	unsubscribe();
	assert.ok(JSON.stringify(replies).includes("OUT:"));
	await controller.dispose();
	const restored = f.controller();
	await restored.connect();
	await restored.receive({ type: "session/list", requestId: "list" });
	await restored.receive({
		type: "session/load",
		requestId: "load",
		sessionId: state.sessionId,
	});
	const recovered = restored.snapshot().tools[0]!;
	const tail = await readOutputTail(restored, recovered);
	assert.ok(tail.includes("ERR:") && tail.includes("Exit code: 7"));
});

/** モデル境界だけを代替し、実際の登録ツールと承認処理を経由する。 */
async function queueExecution(
	f: Awaited<ReturnType<typeof piFixture>>,
	route: string,
	command: string,
	timeout = 60,
) {
	if (route === "codemode") {
		f.options.codemode = true;
		f.model.replies.push(
			{
				name: "codemode",
				arguments: {
					code: `text(await tools.powershell({command:${JSON.stringify(command)}, timeout:${timeout}}));`,
				},
			},
			"完了",
		);
		return;
	}
	if (route === "child") {
		await mkdir(join(f.agentDir, "agents"));
		await writeFile(
			join(f.agentDir, "agents/worker.md"),
			"---\nname: worker\ndescription: 担当\ntools: powershell, write\n---\n指定された処理を行う。\n",
		);
		f.model.replies.push(
			{
				name: "subagent",
				arguments: {
					agent: "worker",
					task: "境界を確認",
					context: "fork",
				},
			},
			{ name: "powershell", arguments: { command, timeout } },
			"子の完了",
			"親の完了",
		);
		return;
	}
	f.model.replies.push(
		{ name: "powershell", arguments: { command, timeout } },
		"完了",
	);
}

/** コマンド入力に含まれる文字列を、途中出力の到着と誤認しない。 */
function hasOutput(tools: ToolSummary[], marker: string) {
	return tools.some(
		(tool) =>
			tool.status === "in_progress" &&
			tool.output?.preview.includes(marker),
	);
}

/** UI と同じ範囲取得で、復元した全文の末尾を確認する。 */
async function readOutputTail(
	controller: PiSessionController,
	tool: ToolSummary,
) {
	let response: ToolOutputResponse | undefined;
	const unsubscribe = controller.subscribe((reply) => {
		if (reply.type === "tool/outputResult") {
			response = reply;
		}
	});
	try {
		await controller.receive({
			type: "tool/output",
			requestId: "tail",
			outputRef: tool.output!.outputRef!,
			offset: tool.output!.totalBytes! - 1500,
			limit: 2000,
		});
	} finally {
		unsubscribe();
	}
	assert.ok(response);
	assert.equal(response.error, undefined);
	assert.equal(response.eof, true);
	return response.text;
}

/** 子の shell が実際に完了したことを、要約とは独立に確認する。 */
async function assertChildCommand(controller: PiSessionController) {
	const state = controller.snapshot();
	let view: unknown;
	const unsubscribe = controller.subscribe((reply) => {
		if (reply.type === "agent/view") {
			view = reply.view;
		}
	});
	try {
		await controller.receive({
			type: "agent/read",
			requestId: "child",
			sessionId: state.sessionId!,
			threadId: state.agents[0]!.threadId,
		});
	} finally {
		unsubscribe();
	}
	assert.ok(
		JSON.stringify(view).includes("DNS_BLOCKED"),
		JSON.stringify(view),
	);
}
