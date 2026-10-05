// 新規プロセスへ履歴 ID を渡し、保存結果から復元された公開状態だけを読む。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isState } from "@nerita/shared/stateValidation";

/** 復元用の子プロセスの起動失敗・例外を、復元成功として扱わない。 */
export async function restoredState(
	f: { root: string; cwd: string; agentDir: string },
	sessionId: string,
) {
	assert.ok(process.env.NERITA_RESTORE_RUNNER);
	const input = join(f.root, `${randomUUID()}.json`);
	const output = `${input}.result`;
	await writeFile(
		input,
		JSON.stringify({ cwd: f.cwd, agentDir: f.agentDir, sessionId, output }),
	);
	const child = spawn(
		process.execPath,
		[process.env.NERITA_RESTORE_RUNNER, input],
		{
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
			timeout: 15000,
		},
	);
	let error = "";
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		error += chunk;
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	assert.equal(code, 0, error);
	const state: unknown = JSON.parse(await readFile(output, "utf8"));
	assert.ok(isState(state));
	assert.equal(
		state.sessionId,
		sessionId,
		"指定した保存履歴の ID で復元する",
	);
	assert.equal(state.sessionsError, null);
	return state;
}
