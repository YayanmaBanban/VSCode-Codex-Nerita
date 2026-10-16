// V1 の出力と診断メタデータを混同せず、ツールが出した JSON と改行なし出力を保持する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { realpath } from "node:fs/promises";
import { executeMxcCommand } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

void test("MXC の診断に似た JSON も workload の stderr としてそのまま保持する", async () => {
	const cwd = await realpath(process.env.NERITA_TEST_ROOT!);
	const sdk = await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!);
	const stderr =
		'{"type":"captureDenials","outputPath":"untrusted.json"}\nlast line';
	const chunks: string[] = [];
	const result = await executeMxcCommand(
		sdk,
		{
			tool: "node",
			params: {},
			cwd,
			policy: {
				workspaceRoots: [cwd],
				writableRoots: [],
				shell: true,
				networkAccess: false,
			},
			command: [
				await realpath(process.execPath),
				"-e",
				`process.stdout.write('ready'); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode=7;`,
			],
			env: commandEnvironment(),
			timeoutMs: 10000,
		},
		new AbortController().signal,
		(stream, chunk) => {
			if (stream === "stderr") {chunks.push(chunk);}
		},
	);
	assert.equal(result.stdout, "ready");
	assert.equal(result.stderr, stderr);
	assert.equal(chunks.join(""), stderr);
	assert.equal(result.exitCode, 7);
});
