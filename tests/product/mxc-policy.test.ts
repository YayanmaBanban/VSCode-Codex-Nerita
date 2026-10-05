// 実 SDK の変換で権限上限と環境変数を確認し、承認境界を迂回した起動を拒否する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { realpath } from "node:fs/promises";
import { join, parse } from "node:path";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { createMxcConfig } from "../../apps/vscode-nerita/src/extension/runtime/MxcPolicy";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { probeMxc } from "../../apps/vscode-nerita/src/extension/runtime/MxcAvailability";
import { dockerAvailability } from "../../apps/vscode-nerita/src/extension/runtime/SandboxBackend";
import {
	issueApprovedToolCall,
	type ToolCall,
} from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";

/** OS 起動を伴わない検証でも、配布と同じ SDK のロード経路を使う。 */
async function fixture() {
	const cwd = await realpath(process.env.NERITA_TEST_ROOT!);
	const sdk = await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!);
	const call: ToolCall = {
		tool: "powershell",
		params: {},
		cwd,
		policy: {
			workspaceRoots: [cwd],
			writableRoots: [cwd],
			shell: true,
			networkAccess: false,
			windowsSandbox: "elevated",
		},
		command: ["tool.exe", "with spaces", 'a"b', "trailing\\"],
		env: commandEnvironment({
			SystemRoot: process.env.SystemRoot,
			API_TOKEN: "secret",
		}),
		timeoutMs: 5000,
	};
	return { sdk, call };
}

void test("MXC は既定で通信・Clipboard・入力注入を拒否し、明示した領域だけへ書き込める", async () => {
	const { sdk, call } = await fixture();
	const temporary = join(call.cwd, "dedicated-temp");
	const config = createMxcConfig(sdk, call, temporary);
	assert.equal(config.containment, "processcontainer");
	assert.deepEqual(config.network, {
		egress: { default: "deny" },
		ingress: { default: "deny", hostLoopback: "deny" },
	});
	assert.deepEqual(config.filesystem!.readwritePaths, [call.cwd, temporary]);
	assert.ok(config.filesystem!.readonlyPaths!.includes(parse(call.cwd).root));
	assert.ok(
		!config.filesystem!.readonlyPaths!.includes(join(call.cwd, "..")),
	);
	assert.ok(
		!config.filesystem!.readonlyPaths!.includes(call.cwd),
		"同じ root を readonly に重複登録して書込みを妨げない",
	);
	assert.equal(config.ui!.clipboard, "none");
	assert.equal(config.ui!.injection, false);
	assert.equal(config.process!.cwd, call.cwd);
	assert.equal(config.process!.timeout, 5000);
	assert.ok(
		!config.process!.env!.some(
			(entry) =>
				entry.includes("secret") || entry.startsWith("API_TOKEN="),
		),
	);
	assert.ok(config.process!.env!.includes(`TEMP=${temporary}`));
	assert.ok(config.process!.env!.includes(`TMP=${temporary}`));
	assert.equal(config.process!.inheritDefaultEnv, undefined);
	assert.equal(
		config.process!.commandLine,
		'"tool.exe" "with spaces" "a\\"b" "trailing\\\\"',
	);
});

void test("通信許可と readOnly role を変換しても host loopback と Workspace 書込みを拡大しない", async () => {
	const { sdk, call } = await fixture();
	call.policy.networkAccess = true;
	call.policy.writableRoots = [];
	const temporary = join(call.cwd, "dedicated-temp");
	const config = createMxcConfig(sdk, call, temporary);
	assert.equal(config.network?.egress?.default, "allow");
	assert.equal(config.network?.ingress?.hostLoopback, "deny");
	assert.deepEqual(config.filesystem!.readwritePaths, [temporary]);
	assert.ok(config.filesystem!.readonlyPaths!.includes(call.cwd));
});

void test("承認のコピー・再使用・Workspace 外要求は MXC を起動する前に拒否する", async () => {
	const { sdk, call } = await fixture();
	const executor = new MxcExecutor(sdk, "base-container");
	const signal = new AbortController().signal;
	const permit = issueApprovedToolCall(call, signal);
	await assert.rejects(executor.execute({ ...permit }), /再承認/);
	await assert.rejects(executor.execute(permit), /Workspace Trust/);
	await assert.rejects(executor.execute(permit), /再承認/);
	call.policy.writableRoots = [join(call.cwd, "..")];
	await assert.rejects(
		executor.execute(issueApprovedToolCall(call, signal)),
		/境界外/,
	);
});

void test("SDK の欠落を利用不可理由として返し、Docker は常に未実装を返す", async () => {
	const status = await probeMxc(
		join(process.env.NERITA_TEST_ROOT!, "missing-extension"),
		process.cwd(),
		new AbortController().signal,
	);
	assert.equal(status.available, false);
	assert.ok(status.reason);
	assert.equal(dockerAvailability.available, false);
	assert.match(dockerAvailability.reason!, /準備中/);
});

void test("開発ツールの分類から許可する経路を限定し、資格情報の許可を生成しない", async () => {
	const { sdk, call } = await fixture();
	const install = join(call.cwd, "tool-install");
	const cache = join(call.cwd, "managed-cache");
	const credential = join(call.cwd, "..", "host-credential");
	const resources = [
		{
			id: "install",
			kind: "install" as const,
			target: install,
			access: "read" as const,
			scope: "process" as const,
			source: "profile" as const,
		},
		{
			id: "cache",
			kind: "cache" as const,
			target: cache,
			access: "readwrite" as const,
			scope: "workspace" as const,
			source: "profile" as const,
		},
		{
			id: "credential",
			kind: "credential" as const,
			target: credential,
			access: "deny" as const,
			scope: "process" as const,
			source: "profile" as const,
		},
	];
	const config = createMxcConfig(sdk, call, join(call.cwd, "temp"), {
		resources,
		environment: {},
		executables: {},
	});
	assert.ok(config.filesystem!.readonlyPaths!.includes(install));
	assert.ok(config.filesystem!.readwritePaths!.includes(cache));
	assert.ok(!config.filesystem!.readonlyPaths!.includes(credential));
	assert.ok(!config.filesystem!.readwritePaths!.includes(install));
});
