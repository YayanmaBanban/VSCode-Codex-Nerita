// MXC 本体の初回・反復・別 Worktree での並行起動を計測し、各呼出しの一時領域の回収を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { piFixture } from "../support/pi";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import type { MxcMeasurement } from "../../apps/vscode-nerita/src/extension/runtime/MxcTiming";
import { WorktreeManager } from "../../apps/vscode-nerita/src/extension/dlc/WorktreeManager";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { issueApprovedToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

void test("MXC の起動計測は入力を記録せず、初回・反復・worktree 並行で呼出しごとに終了する", async (t) => {
	const f = await piFixture(t);
	const targets = await benchmarkTargets(f);
	for (const root of targets) {
		await f.trust.setUserTrust(root, true);
	}
	const trust = bindTrustContext(f.trust, targets, () => true);
	t.after(() => trust.dispose());
	const measured: MxcMeasurement[] = [];
	const executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
		undefined,
		undefined,
		undefined,
		(value) => measured.push(value),
	);
	const executable = await realpath(process.execPath);
	const run = (root: string) =>
		executor.execute(
			issueApprovedToolCall(
				{
					tool: "node",
					params: { command: "node -e console.log('ready')" },
					cwd: root,
					command: [executable, "-e", "console.log('ready')"],
					env: commandEnvironment(),
					timeoutMs: 10000,
					policy: {
						workspaceRoots: [root],
						writableRoots: [root],
						shell: true,
						networkAccess: false,
						trustContextId: trust.id,
					},
				},
				new AbortController().signal,
			),
		);
	for (const phase of ["first", "repeat"]) {
		const result = await run(targets[0]!);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /ready/u);
		console.log(`MXC ${phase}: ${JSON.stringify(measured.at(-1))}`);
	}
	const results = await Promise.all(targets.slice(1).map(run));
	assert.ok(
		results.every(
			(result) =>
				result.exitCode === 0 && result.stdout.includes("ready"),
		),
	);
	assert.equal(measured.length, 4);
	for (const metric of measured) {
		assertMeasurement(metric);
	}
	console.log(`MXC concurrent: ${JSON.stringify(measured.slice(2))}`);
});

function assertMeasurement(metric: MxcMeasurement): void {
	for (const value of Object.values(metric)) {
		assert.ok(value === null || (Number.isFinite(value) && value >= 0));
	}
	assert.ok(metric.executionMs > 0 && metric.cleanupMs > 0);
	assert.ok(metric.firstOutputMs !== null);
}

async function benchmarkTargets(
	f: Awaited<ReturnType<typeof piFixture>>,
): Promise<string[]> {
	const execute = promisify(execFile);
	await execute("git", ["init", f.cwd], { windowsHide: true });
	await execute(
		"git",
		[
			"-C",
			f.cwd,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"--allow-empty",
			"-m",
			"initial",
		],
		{ windowsHide: true },
	);
	const manager = new WorktreeManager(f.cwd, join(f.root, "host"));
	const targets = [
		await realpath(f.cwd),
		(await manager.create()).root,
		(await manager.create()).root,
	];
	return targets;
}
