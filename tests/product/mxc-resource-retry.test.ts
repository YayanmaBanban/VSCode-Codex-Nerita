// MXC の OS 境界だけを代替し、消費済み承認の再実行・同一性・一時権限の回収を確認する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PassThrough } from "node:stream";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { createMxcRequest } from "../../apps/vscode-nerita/src/extension/runtime/MxcPolicy";
import { piFixture, until } from "../support/pi";
import { SandboxManagement } from "../../apps/vscode-nerita/src/extension/runtime/SandboxManagement";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { loadMxcSdk, type MxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { issueApprovedToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

type ContainerConfig = ReturnType<typeof createMxcRequest>;

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
	const sdk = await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!);
	const executor = new MxcExecutor(
		mockProcess(sdk, policies, executable),
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
	);
	await assert.rejects(executor.execute(call));
}

/** 追加するファイル許可以外の実行条件が変わらないことを照合する。 */
function retryIdentity(policy: ContainerConfig) {
	return [policy.command, policy.workingDirectory, policy.network];
}

/** SDK のプロセス境界だけを代替し、分類・承認・出力・再実行は本番経路を使う。 */
function mockProcess(
	sdk: MxcSdk,
	policies: ContainerConfig[],
	target: string,
): MxcSdk {
	return {
		...sdk,
		async spawn(request) {
			const config = request.containment;
			assert.equal(config?.type, "processcontainer");
			const outputPath = config.config?.captureDenials?.outputPath;
			assert.equal(typeof outputPath, "string");
			if (outputPath === undefined) {
				throw new Error("missing capture output");
			}
			policies.push({ ...structuredClone(request), containment: config });
			const denied = policies.length === 1;
			await writeFile(
				join(dirname(outputPath), "denials.fixture.json"),
				JSON.stringify({
					denials: denied
						? [
								{
									resource: target,
									resourceType: "file",
									accessType: "execute",
								},
							]
						: [],
					summary: {
						totalDenials: denied ? 1 : 0,
						deniedResourcesTruncated: false,
					},
				}),
			);
			const output = new PassThrough();
			output.end(denied ? "DENIED" : "RETRIED");
			return new sdk.MxcProcess({
				id: 0,
				standardInput: null,
				standardOutput: output,
				standardError: null,
				poll: () => ({
					running: false,
					exitCode: denied ? 1 : 0,
					timedOut: false,
				}),
				wait: () =>
					Promise.resolve({
						exitCode: denied ? 1 : 0,
						timedOut: false,
					}),
				warnings: () => [],
				outputMetadata: () => undefined,
				kill() {},
				killForTimeout() {},
				free: () => Promise.resolve(),
			});
		},
	};
}
