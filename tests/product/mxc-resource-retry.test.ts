// MXC の OS 境界だけを代替し、消費済み承認の再実行・同一性・一時権限の回収を確認する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import childProcess, { type SpawnOptions } from "node:child_process";
import { realpath } from "node:fs/promises";
import type { createMxcConfig } from "../../apps/vscode-nerita/src/extension/runtime/MxcPolicy";
import { piFixture, until } from "../support/pi";
import { SandboxManagement } from "../../apps/vscode-nerita/src/extension/runtime/SandboxManagement";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { issueApprovedToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

type ContainerConfig = ReturnType<typeof createMxcConfig>;

for (const outcome of ["retry", "cancel"] as const) {
	void test(`拒否後も同じ承認内容だけを再実行し、一時許可を回収する（${outcome}）`, (t) =>
		verifyRetry(t, outcome));
}

/** 元の承認を一度だけ消費し、UI 操作の前後を検査する。 */
async function verifyRetry(t: TestContext, outcome: "retry" | "cancel") {
	const f = await piFixture(t);
	const cwd = await realpath(f.cwd);
	const executable = await realpath(process.execPath);
	const trust = bindTrustContext(f.trust, [cwd], () => true);
	t.after(() => trust.dispose());
	const manager = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		{ read: () => undefined, write: () => Promise.resolve() },
	);
	const policies: ContainerConfig[] = [];
	mockLauncher(t, policies, executable);
	const executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
		undefined,
		undefined,
		manager,
	);
	const abort = new AbortController();
	const call = issueApprovedToolCall(
		{
			tool: "node",
			params: { command: "original" },
			cwd,
			command: [executable, "-e", "console.log('original')"],
			env: commandEnvironment(),
			timeoutMs: 5000,
			policy: {
				workspaceRoots: [cwd],
				writableRoots: [cwd],
				shell: true,
				networkAccess: false,
				windowsSandbox: "elevated",
				trustContextId: trust.id,
			},
		},
		abort.signal,
	);
	const execution = executor.execute(call);
	await until(() =>
		manager
			.snapshot()
			.denials.some((event) => event.actions.includes("allow")),
	);
	const event = manager
		.snapshot()
		.denials.find((item) => item.actions.includes("allow"))!;
	assert.equal(manager.snapshot().resourceGrants.length, 0);
	assert.equal(policies.length, 1, "UI 操作前には再実行しない");
	if (outcome === "cancel") {
		abort.abort();
		await assert.rejects(execution);
		assert.equal(policies.length, 1);
	} else {
		await manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope: "process",
		});
		assert.equal((await execution).stdout, "DENIEDRETRIED");
		assert.equal(policies.length, 2);
		assert.deepEqual(
			retryIdentity(policies[1]!),
			retryIdentity(policies[0]!),
		);
	}
	assert.equal(manager.snapshot().resourceGrants.length, 0);
	await assert.rejects(
		manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope: "process",
		}),
		/期限切れ/,
	);
	await assert.rejects(executor.execute(call), /再承認|abort/i);
}

/** 追加するファイル許可以外の実行条件が変わらないことを照合する。 */
function retryIdentity(policy: ContainerConfig) {
	return [policy.process?.commandLine, policy.process?.cwd, policy.network];
}

/** ランチャーの stdin 契約で拒否レポートを作り、本番の分類・保存・承認・出力処理を残す。 */
function mockLauncher(
	t: TestContext,
	policies: ContainerConfig[],
	target: string,
) {
	const original = childProcess.spawn;
	let launches = 0;
	t.mock.method(
		childProcess,
		"spawn",
		(file: string, args: readonly string[], options: SpawnOptions) => {
			if (!args.some((arg) => arg.endsWith("nerita-mxc-launcher.ps1"))) {
				return original(file, args, options);
			}
			const denied = launches++ === 0;
			const body = `let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',s=>input+=s); process.stdin.on('end',()=>{
const config=JSON.parse(input); const fs=require('node:fs'); const path=require('node:path');
const report={denials:${denied ? JSON.stringify([{ resource: target, resourceType: "file", accessType: "execute" }]) : "[]"}, summary:{totalDenials:${denied ? 1 : 0},deniedResourcesTruncated:false}};
fs.writeFileSync(path.join(path.dirname(config.processContainer.captureDenials.outputPath),'denials.fixture.json'),JSON.stringify(report)); process.stdout.write('${denied ? "DENIED" : "RETRIED"}'); process.exitCode=${denied ? 1 : 0}; });`;
			const child = original(process.execPath, ["-e", body], options);
			const stdin = child.stdin!;
			const write = stdin.end.bind(stdin);
			stdin.end = ((input: string, encoding: BufferEncoding) => {
				policies.push(JSON.parse(input) as ContainerConfig);
				return write(input, encoding);
			}) as typeof stdin.end;
			return child;
		},
	);
}
