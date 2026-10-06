// SDK 本体と pnpm 本体で、承認前の副作用禁止とコマンドクラスごとの再承認を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { piFixture, send, permission, finished, until } from "../support/pi";
import { CommandPermissions } from "../../apps/vscode-nerita/src/extension/runtime/CommandPermissions";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { setTimeout } from "node:timers/promises";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";

/** コマンド本文ではなく、実行中に Host が受信した出力だけを待つ。 */
function hasRunningOutput(tools: ToolSummary[], text: string): boolean {
	return tools.some(
		(tool) =>
			tool.status === "in_progress" &&
			Boolean(tool.output?.preview.includes(text)),
	);
}

void test("Pi は native pnpm を承認前に起動せず、照会のセッション承認から実行へ昇格しない", async (t) => {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	f.options.commandPermissions = new CommandPermissions({
		read: () => [],
		write: () => Promise.resolve(),
	});
	await writeFile(
		join(f.cwd, "package.json"),
		JSON.stringify({
			name: "mxc-approval-fixture",
			version: "1.0.0",
			scripts: { probe: "node probe.cjs" },
		}),
	);
	await writeFile(
		join(f.cwd, "probe.cjs"),
		"require('node:fs').writeFileSync('approved.txt', 'host-approved'); console.log('HOST_PROBE_OK');",
	);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push(
		{ name: "pnpm", arguments: { args: ["--version"] } },
		"照会完了",
	);
	await send(controller, "pnpm のバージョンを確認");
	await until(
		() => controller.snapshot().permissions.length === 1,
		() => controller.snapshot(),
	);
	const first = controller.snapshot().permissions[0]!;
	assert.deepEqual(
		first.options.map((option) => option.id),
		["accept", "accept-session", "accept-workspace", "cancel"],
	);
	assert.equal(first.commandPermission?.commandClass, "read-only-ish");
	assert.equal(first.commandPermission?.route, "host");
	await permission(controller, "accept-session");
	let state = await finished(controller);
	assert.equal(
		state.tools[0]!.status,
		"completed",
		JSON.stringify(state.tools),
	);
	f.model.replies.push(
		{ name: "pnpm", arguments: { args: ["run", "probe"] } },
		"実行完了",
	);
	await send(controller, "pnpm でスクリプトを実行");
	await until(
		() => controller.snapshot().permissions.length === 1,
		() => controller.snapshot(),
	);
	assert.equal(
		controller.snapshot().permissions[0]!.commandPermission?.commandClass,
		"execution",
	);
	await assert.rejects(readFile(join(f.cwd, "approved.txt")), {
		code: "ENOENT",
	});
	await permission(controller, "accept");
	state = await finished(controller);
	assert.equal(
		await readFile(join(f.cwd, "approved.txt"), "utf8"),
		"host-approved",
		JSON.stringify(state.tools),
	);
	assert.equal(state.tools.at(-1)!.status, "completed");
	await verifyInstallation(f, controller);
});

/** 照会・実行の承認後でも依存変更は独立した承認を要求する。ネットワーク接続は行わない。 */
async function verifyInstallation(
	f: Awaited<ReturnType<typeof piFixture>>,
	controller: PiSessionController,
) {
	f.model.replies.push(
		{
			name: "pnpm",
			arguments: { args: ["install", "--offline", "--ignore-scripts"] },
		},
		"依存確認完了",
	);
	await send(controller, "ネットワークなしで依存を確認");
	await until(
		() => controller.snapshot().permissions.length === 1,
		() => controller.snapshot(),
	);
	assert.equal(
		controller.snapshot().permissions[0]!.commandPermission?.commandClass,
		"installation-network",
	);
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.tools.at(-1)!.exitCode, 0, JSON.stringify(state.tools));
}

void test("Pi の Host ファイル読取りはワークスペース外とそこへの junction を拒否する", async (t) => {
	const f = await piFixture(t);
	await writeFile(join(f.root, "private.txt"), "HOST_PRIVATE_MARKER");
	const outside = join(f.root, "outside");
	await mkdir(outside);
	await writeFile(join(outside, "private.txt"), "JUNCTION_PRIVATE_MARKER");
	await symlink(outside, join(f.cwd, "linked"), "junction");
	f.model.replies.push(
		{ name: "read", arguments: { path: "../private.txt" } },
		"拒否を確認",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "外部ファイルを読む");
	const state = await finished(controller);
	assert.equal(state.tools[0]!.status, "failed");
	assert.ok(!f.model.requests.at(-1)!.includes("HOST_PRIVATE_MARKER"));
	f.model.replies.push(
		{ name: "read", arguments: { path: "linked/private.txt" } },
		"拒否を確認",
	);
	await send(controller, "リンク経由で外部ファイルを読む");
	const linked = await finished(controller);
	assert.equal(linked.tools.at(-1)!.status, "failed");
	assert.ok(!f.model.requests.at(-1)!.includes("JUNCTION_PRIVATE_MARKER"));
});

void test("Pi の MXC シェルは cwd と出力更新を維持し、途中出力の受信後に停止できる", async (t) => {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push(
		{
			name: "powershell",
			arguments: {
				command:
					"Write-Output ('MXC_CWD=' + (Get-Location).Path); Start-Sleep -Seconds 20; Set-Content -LiteralPath stopped.txt -Value forbidden",
			},
		},
		"停止済み",
	);
	await send(controller, "実行と停止を確認");
	await permission(controller, "accept");
	await until(
		() => hasRunningOutput(controller.snapshot().tools, "MXC_CWD="),
		() => controller.snapshot(),
	);
	const state = controller.snapshot();
	await controller.receive({
		type: "prompt/cancel",
		requestId: "stop-mxc",
		sessionId: state.sessionId,
		runId: state.runId,
	});
	await finished(controller);
	await assert.rejects(readFile(join(f.cwd, "stopped.txt")), {
		code: "ENOENT",
	});
});

for (const stop of ["cancel", "timeout"]) {
	void test(`Pi の Host pnpm を停止すると配下の Node も止まり、遅れた書込みが起きない（${stop}）`, async (t) => {
		const f = await piFixture(t);
		f.options.executor = new MxcExecutor(
			await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
			"base-container",
		);
		await writeFile(
			join(f.cwd, "package.json"),
			JSON.stringify({ scripts: { probe: "node child.cjs" } }),
		);
		await writeFile(
			join(f.cwd, "child.cjs"),
			"console.log('HOST_CHILD_READY'); setTimeout(() => require('node:fs').writeFileSync('late.txt','forbidden'), 3000);",
		);
		const controller = f.controller();
		await controller.connect();
		f.model.replies.push(
			{
				name: "pnpm",
				arguments: {
					args: ["run", "probe"],
					timeout: stop === "timeout" ? 1 : 60,
				},
			},
			"停止済み",
		);
		await send(controller, "ホスト実行の停止を確認");
		await permission(controller, "accept");
		await until(
			() =>
				hasRunningOutput(
					controller.snapshot().tools,
					"HOST_CHILD_READY",
				),
			() => controller.snapshot(),
		);
		if (stop === "cancel") {
			const state = controller.snapshot();
			await controller.receive({
				type: "prompt/cancel",
				requestId: "stop-host",
				sessionId: state.sessionId,
				runId: state.runId,
			});
		}
		const final = await finished(controller);
		if (stop === "timeout") {
			assert.ok(JSON.stringify(final.tools).includes("タイムアウト"));
		}
		await setTimeout(3500);
		await assert.rejects(readFile(join(f.cwd, "late.txt")), {
			code: "ENOENT",
		});
	});
}
