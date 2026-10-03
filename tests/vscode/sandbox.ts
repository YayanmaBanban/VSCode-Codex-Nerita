// Codex 本体の OS によるアクセス制限を確認する。承認 UI の検証とは分け、承認済みコマンドを使う。
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCodexSandboxExecutor } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSandboxExecutor";
import { issueApprovedToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

/** 準備失敗ではなく、同じ実行経路での書込み成功と OS 拒否を対にして観測する。 */
async function main() {
	const extension = process.env.NERITA_DISTRIBUTION_TEST_EXTENSION;
	const root = process.env.NERITA_WINDOWS_TEST_ROOT;
	assert.ok(extension && root);
	const workspace = join(root, "workspace");
	const outside = join(root, "outside.txt");
	await mkdir(workspace);
	await writeFile(outside, "original");
	const cwd = await realpath(workspace);
	const trust = new WorkspaceTrustStore({
		read: () => undefined,
		write: () => Promise.resolve(),
	});
	await trust.setUserTrust(cwd, true);
	const context = bindTrustContext(trust, [cwd], () => true);
	const executor = createCodexSandboxExecutor(extension);
	/** スクリプトは新しい領域に置き、引数をシェルの文字列展開へ渡さない。 */
	const execute = async (
		source: string,
		signal = AbortSignal.timeout(25000),
	) => {
		const script = join(cwd, "command.cjs");
		await writeFile(script, source);
		return executor.execute(
			issueApprovedToolCall(
				{
					tool: "bash",
					params: { command: "node ./command.cjs" },
					cwd,
					command: [process.execPath, script],
					env: commandEnvironment(),
					timeoutMs: 15000,
					policy: {
						workspaceRoots: [cwd],
						writableRoots: [cwd],
						networkAccess: false,
						shell: true,
						windowsSandbox: "elevated",
						trustContextId: context.id,
					},
				},
				signal,
			),
		);
	};
	try {
		const allowed = await execute(
			"require('node:fs').writeFileSync('inside.txt', 'allowed')",
		);
		assert.equal(allowed.exitCode, 0);
		assert.equal(
			await readFile(join(cwd, "inside.txt"), "utf8"),
			"allowed",
		);
		// 子プロセスにも同じ境界が適用され、拒否時の例外を捕捉して成功扱いにしていないことを確認する。
		const denied = `require('node:fs').writeFileSync(${JSON.stringify(outside)}, 'changed')`;
		await assert.rejects(
			execute(
				`const r = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(denied)}], {encoding:'utf8'}); process.stderr.write(r.stderr); process.exit(r.status ?? 1);`,
			),
			/sandbox denied.*|EPERM|EACCES/i,
		);
		assert.equal(await readFile(outside, "utf8"), "original");
		const created = join(root, "created.txt");
		await assert.rejects(
			execute(
				`require('node:fs').writeFileSync(${JSON.stringify(created)}, 'outside')`,
			),
			/sandbox denied.*|EPERM|EACCES/i,
		);
		await assert.rejects(access(created), { code: "ENOENT" });
		await verifyStopped(cwd, execute);
		console.log(
			"実 Windows Sandbox: 許可領域の書込み成功、領域外の書込み拒否、停止時に子孫を回収",
		);
	} finally {
		context.dispose();
	}
}

/** 稼働中の子孫プロセスが停止後に残らず、ファイルへの追記も止まることを確認する。 */
async function verifyStopped(
	cwd: string,
	execute: (source: string, signal: AbortSignal) => Promise<unknown>,
) {
	// 書込みが始まった子孫を止め、終了後も更新が続く孤児プロセスを検出する。
	const leaf = join(cwd, "leaf.cjs");
	await writeFile(
		leaf,
		`const fs = require('node:fs'); fs.writeFileSync('leaf.pid', String(process.pid)); setInterval(() => fs.appendFileSync('heartbeat.txt', '.'), 30);`,
	);
	const child = join(cwd, "child.cjs");
	await writeFile(
		child,
		`require('node:fs').writeFileSync('child.pid', String(process.pid)); require('node:child_process').spawn(process.execPath, [${JSON.stringify(leaf)}], {stdio:'inherit'}); setInterval(() => {}, 1000);`,
	);
	const stop = new AbortController();
	const running = execute(
		`require('node:child_process').spawn(process.execPath, [${JSON.stringify(child)}], {stdio:'inherit'}); setInterval(() => {}, 1000);`,
		stop.signal,
	);
	const outcome = running.then(
		() => "completed",
		() => "cancelled",
	);
	const pids: number[] = [];
	try {
		const deadline = Date.now() + 12000;
		while (Date.now() < deadline) {
			if (await heartbeatStarted(cwd)) {
				break;
			}
			await setTimeout(20);
		}
		assert.ok(
			(await readFile(join(cwd, "heartbeat.txt"), "utf8")).length >= 2,
		);
		for (const name of ["child.pid", "leaf.pid"]) {
			pids.push(Number(await readFile(join(cwd, name), "utf8")));
		}
		assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
		stop.abort(new Error("利用者による停止"));
		assert.equal(await outcome, "cancelled");
		for (const pid of pids) {
			assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
		}
		const after = await readFile(join(cwd, "heartbeat.txt"), "utf8");
		await setTimeout(150);
		assert.equal(await readFile(join(cwd, "heartbeat.txt"), "utf8"), after);
	} finally {
		stop.abort();
		await outcome;
		// 失敗した場合も、この実行で記録した子孫だけを回収する。
		for (const pid of pids) {
			try {
				process.kill(pid, 0);
			} catch {
				continue;
			}
			await promisify(execFile)("taskkill.exe", [
				"/PID",
				String(pid),
				"/T",
				"/F",
			]).catch(() => undefined);
		}
	}
}

/** 起動を待つ間のファイル未作成だけを許容し、その他の読み取り失敗を隠さない。 */
async function heartbeatStarted(cwd: string) {
	try {
		return (await readFile(join(cwd, "heartbeat.txt"), "utf8")).length >= 2;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		return false;
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
