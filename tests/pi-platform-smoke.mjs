// OS 判定だけを模擬し、配布 SDK と本番 Runtime から通常 `bash`・信頼済み `bash` を呼ぶ。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** 実 OS の検証とは分け、モデルへのツール公開・承認・SDK 実行の接続を確かめる。 */
export async function piPlatformSmoke({
	createPiRuntime,
	extensionPath,
	agentDir,
	requests,
}) {
	const shellPath = testShellPath();
	const platformDescriptor = Object.getOwnPropertyDescriptor(
		process,
		"platform",
	);
	const modes = shellPath === null ? [true] : [false, true];
	if (shellPath === null) {
		console.log("SKIP: native bash platform cases (set NERITA_PI_BASH)");
	}
	try {
		for (const platform of ["darwin", "linux"]) {
			Object.defineProperty(process, "platform", { value: platform });
			for (const external of modes) {
				await platformCase({
					createPiRuntime,
					extensionPath,
					agentDir,
					requests,
					platform,
					external,
					shellPath,
				});
			}
		}
	} finally {
		Object.defineProperty(process, "platform", platformDescriptor);
	}
}

/** ユーザー設定から隔離した作業場所と Pi 設定を使う。 */
async function platformCase({
	createPiRuntime,
	extensionPath,
	agentDir,
	requests,
	platform,
	external,
	shellPath,
}) {
	const caseDir = path.join(extensionPath, `${platform}-${external}`);
	const cwd = path.join(caseDir, "workspace");
	const isolatedAgent = path.join(caseDir, "agent");
	await mkdir(cwd, { recursive: true });
	await mkdir(isolatedAgent);
	await cp(
		path.join(agentDir, "models.json"),
		path.join(isolatedAgent, "models.json"),
	);
	await writeFile(
		path.join(isolatedAgent, "settings.json"),
		JSON.stringify({
			shellPath,
			shellCommandPrefix: "printf 'host-prefix\\n'",
		}),
	);
	const entry = path.join(isolatedAgent, "shell.mjs");
	await writeFile(
		entry,
		`export default pi => pi.registerTool({
			name: "bash", label: "External shell", description: "Trusted shell fixture",
			parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
			async execute() { return { content: [{ type: "text", text: "external-shell-result" }], details: {} }; }
		});`,
	);
	const approvals = [];
	const abort = new AbortController();
	const session = await createPiRuntime({
		extensionPath,
		cwd,
		agentDir: isolatedAgent,
		preferredModel: { provider: "local", model: "smoke" },
		trustedExtensionPaths: external ? [entry] : [],
		ephemeral: true,
		executor: null,
		sandboxUnavailable: "Windows Sandbox must not block this session",
		signal: abort.signal,
		authorize: (title) => {
			approvals.push(title);
			return Promise.resolve(abort.signal);
		},
	});
	try {
		const firstRequest = requests.length;
		await session.prompt(
			`policy:${JSON.stringify({ name: "bash", args: { command: "node --version", timeout: 30 } })}`,
		);
		const names = requests[firstRequest].tools.map(
			(tool) => tool.function.name,
		);
		assert.equal(names.filter((name) => name === "bash").length, 1);
		for (const name of ["read", "ls", "write", "edit"]) {
			assert.ok(names.includes(name), name);
		}
		assert.ok(!names.includes("powershell") && !names.includes("pwsh"));
		assert.equal(approvals.length, 1);
		const scope = approvals[0].fields.find((field) => field.id === "scope");
		assert.ok(scope);
		assert.match(scope.value, /Pi Shell/);
		assert.doesNotMatch(scope.value, /Sandbox/);
		const result = session.messages.findLast(
			(message) => message.role === "toolResult",
		);
		assert.equal(result.isError, false, JSON.stringify(result));
		const output = JSON.stringify(result.content);
		if (external) {
			assert.match(output, /external-shell-result/);
			assert.doesNotMatch(output, /host-prefix/);
		} else {
			assert.match(output, /host-prefix/);
			assert.match(output, /v\d+\.\d+\.\d+/);
		}
		console.log(
			`PASS: simulated ${platform} → packaged SDK → approved ${external ? "trusted bash override" : "native bash + node --version"} without Sandbox`,
		);
	} finally {
		await session.close();
	}
}

/** Windows 上の OS 模擬には導入済み Git Bash を使い、存在しなければ成功扱いしない。 */
function testShellPath() {
	if (process.platform !== "win32") {
		return process.env.NERITA_PI_BASH;
	}
	const configured = process.env.NERITA_PI_BASH;
	const candidate =
		configured ??
		path.join(process.env.ProgramFiles ?? "", "Git", "bin", "bash.exe");
	return existsSync(candidate) ? candidate : null;
}
