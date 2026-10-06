// 実際の MXC / native pnpm と同梱 Pi SDK を通し、モデル・履歴・環境への秘密値混入を検出する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import childProcess, {
	type ChildProcess,
	type SpawnOptions,
} from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	piFixture,
	send,
	permission,
	finished,
	until,
	sessionFiles,
} from "../support/pi";
import { credentialFixture } from "../support/credentials";
import { CredentialBroker } from "../../apps/vscode-nerita/src/extension/credentials/CredentialBroker";
import { BindingStore } from "../../apps/vscode-nerita/src/extension/credentials/BindingStore";
import { CredentialProviderRegistry } from "../../apps/vscode-nerita/src/extension/credentials/CredentialProvider";
import { BitwardenSecretsProvider } from "../../apps/vscode-nerita/src/extension/credentials/BuiltinCredentialProviders";
import { SecretValue } from "../../apps/vscode-nerita/src/extension/credentials/CredentialStore";
import { credentialBindingSchema } from "../../packages/shared/src/credentials";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";

for (const route of ["mxc", "host", "codemode", "child"]) {
	void test(`資格情報は実行と利用の承認後だけ注入され、BWS 認証と秘密値を結果へ渡さない（${route}）`, (t) =>
		verifyInjection(t, route));
}

/** 子や Codemode の内部操作も、親のブローカーと承認経路を通す。 */
async function verifyInjection(t: TestContext, route: string) {
	const checkLauncher = route === "mxc" ? observeLauncher(t) : async () => {};
	const f = await piFixture(t);
	const storage = credentialFixture();
	f.options.credentials = storage.credentials;
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	const acquired = await configureBroker(f, storage);
	const command = `Write-Output 'https://api.example.test'; Write-Output ('TOKEN_PRESENT=' + [bool]$env:FIXTURE_API_TOKEN); Write-Output ('BWS_PRESENT=' + [bool]$env:BWS_ACCESS_TOKEN); Write-Output $env:FIXTURE_API_TOKEN${route === "mxc" ? "; $line = 'x' * 1024; for ($i=0; $i -lt 2048; $i++) { [Console]::Out.WriteLine($line + $env:FIXTURE_API_TOKEN); [Console]::Error.WriteLine($line + $env:FIXTURE_API_TOKEN) }; Start-Sleep -Seconds 2" : ""}`;
	await queueExecution(f, route, command);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "資格情報が必要な処理を実行");
	if (route === "codemode" || route === "child") {
		await permission(controller, "accept");
	}
	await permission(controller, "accept");
	await until(() => controller.snapshot().permissions.length === 1);
	assert.equal(acquired(), 0, "コマンド承認だけでは資格情報を取得しない");
	assert.match(controller.snapshot().permissions[0]!.title, /資格情報/);
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null, JSON.stringify(state));
	assert.equal(acquired(), 1);
	if (route === "mxc") {
		assert.equal(state.tools[0]!.output!.truncated, true);
		assert.ok(state.tools[0]!.output!.preview.length < 30000);
		assert.ok(state.tools[0]!.output!.totalBytes! > 4_000_000);
	}
	const combined = JSON.stringify(state) + f.model.requests.join("\n");
	assert.ok(
		combined.includes("TOKEN_PRESENT=True") ||
			combined.includes("TOKEN_PRESENT=true"),
		combined,
	);
	assert.ok(
		combined.includes("BWS_PRESENT=False") ||
			combined.includes("BWS_PRESENT=false"),
		combined,
	);
	assert.ok(
		!combined.includes("TOOL_PRIVATE_VALUE") &&
			!combined.includes("BWS_AUTH_PRIVATE"),
	);
	assert.ok(
		f.model.requests.every(
			(request) =>
				!request.includes("TOOL_PRIVATE_VALUE") &&
				!request.includes("BWS_AUTH_PRIVATE"),
		),
	);
	const saved = await sessionFiles(f.cwd);
	assert.ok(
		saved.every(
			(file) =>
				!file.text.includes("TOOL_PRIVATE_VALUE") &&
				!file.text.includes("BWS_AUTH_PRIVATE"),
		),
	);
	await checkLauncher();
}

/** 起動を代替せず呼出しを記録し、Sandbox と別にランチャーの引数・環境を検査する。 */
function observeLauncher(t: TestContext) {
	const previous = process.env.BWS_ACCESS_TOKEN;
	const previousApiKey = process.env.OPENAI_API_KEY;
	process.env.BWS_ACCESS_TOKEN = "HOST_BWS_PRIVATE";
	process.env.OPENAI_API_KEY = "HOST_API_PRIVATE";
	t.after(() => {
		if (previous === undefined) {
			delete process.env.BWS_ACCESS_TOKEN;
		} else {
			process.env.BWS_ACCESS_TOKEN = previous;
		}
		if (previousApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = previousApiKey;
		}
	});
	const launches: {
		args: readonly string[];
		env: NodeJS.ProcessEnv | undefined;
		cli: Promise<string>;
	}[] = [];
	const spawn = childProcess.spawn;
	t.mock.method(
		childProcess,
		"spawn",
		(file: string, args: readonly string[], options: SpawnOptions) => {
			const child = spawn(file, args, options);
			if (args.some((arg) => arg.endsWith("nerita-mxc-launcher.ps1"))) {
				launches.push({
					args,
					env: options.env,
					cli: observeCli(child),
				});
			}
			return child;
		},
	);
	return async () => {
		assert.equal(
			launches.length,
			1,
			"実際の MXC ランチャーの起動を確認する",
		);
		const launch = launches[0]!;
		assert.ok(
			!launch.args.includes("--config-base64"),
			"設定を引数へ載せない",
		);
		assert.ok(!JSON.stringify(launch).includes("TOOL_PRIVATE_VALUE"));
		assert.ok(!JSON.stringify(launch).includes("HOST_BWS_PRIVATE"));
		assert.ok(!JSON.stringify(launch).includes("HOST_API_PRIVATE"));
		assert.ok(!JSON.stringify(launch).includes("BWS_AUTH_PRIVATE"));
		assert.equal(launch.env?.BWS_ACCESS_TOKEN, undefined);
		assert.equal(launch.env?.OPENAI_API_KEY, undefined);
		assert.equal(launch.env?.FIXTURE_API_TOKEN, undefined);
		assert.equal(launch.env?.SystemRoot, process.env.SystemRoot);
		const cli = await launch.cli;
		assert.ok(cli.includes("--config \\\\.\\pipe\\nerita-mxc-"), cli);
		assert.ok(!cli.includes("--config-base64"), cli);
		assert.ok(!cli.includes("TOOL_PRIVATE_VALUE"), cli);
		assert.ok(
			!cli.includes(Buffer.from("TOOL_PRIVATE_VALUE").toString("base64")),
			cli,
		);
	};
}

/** 実行中の子 CLI を OS から確認し、ラッパーの引数だけを検証して終わらない。 */
function observeCli(child: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let started = false;
		child.once("close", () => {
			if (!started) {
				reject(new Error("MXC CLI の実行を観測できません。"));
			}
		});
		child.stdout!.once("data", () => {
			started = true;
			void queryCli(child.pid!).then(resolve, reject);
		});
	});
}

/** 固定名の SDK CLI について、実行中のコマンドラインだけを取得する。 */
async function queryCli(parentPid: number): Promise<string> {
	const { stdout } = await promisify(childProcess.execFile)(
		join(
			process.env.SystemRoot!,
			"System32/WindowsPowerShell/v1.0/powershell.exe",
		),
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${parentPid} AND Name = "wxc-exec.exe"' | Select-Object -ExpandProperty CommandLine`,
		],
		{ windowsHide: true, timeout: 5000 },
	);
	const pipe = stdout.match(
		/--config (\\\\\.\\pipe\\nerita-mxc-[a-f0-9]+)/,
	)?.[1];
	assert.ok(pipe, stdout);
	assert.equal(
		await readConfigPipe(pipe),
		"",
		"起動した CLI 以外へ設定を渡さない",
	);
	return stdout;
}

/** 同じユーザーの別 PID で接続しても、秘密値を受け取れないことを確認する。 */
function readConfigPipe(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const socket = createConnection(path);
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			output += chunk;
		});
		socket.once("end", () => resolve(output));
		socket.once("error", reject);
		socket.setTimeout(1000, () =>
			socket.destroy(
				new Error("設定パイプの拒否待ちがタイムアウトしました。"),
			),
		);
	});
}

/** 実行経路の外部境界は置き換えず、ローカルモデルの応答だけで操作を指定する。 */
async function queueExecution(
	f: Awaited<ReturnType<typeof piFixture>>,
	route: string,
	command: string,
) {
	if (route === "host") {
		await writeFile(
			join(f.cwd, "package.json"),
			JSON.stringify({ scripts: { probe: "node probe.cjs" } }),
		);
		await writeFile(
			join(f.cwd, "probe.cjs"),
			"console.log('TOKEN_PRESENT=' + !!process.env.FIXTURE_API_TOKEN); console.log('BWS_PRESENT=' + !!process.env.BWS_ACCESS_TOKEN); console.log(process.env.FIXTURE_API_TOKEN);",
		);
		f.model.replies.push(
			{
				name: "pnpm",
				arguments: {
					args: ["run", "probe", "https://api.example.test"],
				},
			},
			"完了",
		);
		return;
	}
	if (route === "codemode") {
		f.options.codemode = true;
		f.model.replies.push(
			{
				name: "codemode",
				arguments: {
					code: `text(await tools.powershell({command: ${JSON.stringify(command)}}));`,
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
			"---\nname: worker\ndescription: 担当\ntools: powershell\n---\n指示された処理だけを行う。\n",
		);
		f.model.replies.push(
			{
				name: "subagent",
				arguments: {
					agent: "worker",
					task: "資格情報を使う処理",
					context: "fork",
				},
			},
			{ name: "powershell", arguments: { command } },
			"子の完了",
			"親の完了",
		);
		return;
	}
	f.model.replies.push(
		{ name: "powershell", arguments: { command } },
		"完了",
	);
}
/** BWS の HTTP/CLI 境界だけを置き換え、製品の取得・注入経路は維持する。 */
async function configureBroker(
	f: Awaited<ReturnType<typeof piFixture>>,
	storage: ReturnType<typeof credentialFixture>,
) {
	const bindings = new BindingStore(f.cwd);
	await bindings.update(() => [
		credentialBindingSchema.parse({
			id: "api",
			match: { kind: "api-token", target: "api.example.test" },
			provider: {
				type: "bitwarden-secrets-manager",
				secretId: "2863ced6-eba1-48b4-b5c0-afa30104877a",
			},
			injection: { type: "env", name: "FIXTURE_API_TOKEN" },
		}),
	]);
	await storage.stores.memory.set(
		"bws.auth.default",
		new SecretValue("BWS_AUTH_PRIVATE"),
	);
	storage.stores.redactor.protect("BWS_AUTH_PRIVATE");
	let acquired = 0;
	const provider = new BitwardenSecretsProvider(
		storage.stores.memory,
		(_name, _args, _root, _signal, _input, env) => {
			acquired++;
			assert.equal(env?.BWS_ACCESS_TOKEN, "BWS_AUTH_PRIVATE");
			return Promise.resolve(
				JSON.stringify({
					id: "2863ced6-eba1-48b4-b5c0-afa30104877a",
					value: "TOOL_PRIVATE_VALUE",
				}),
			);
		},
	);
	f.options.credentialBroker = new CredentialBroker(
		bindings,
		new CredentialProviderRegistry([provider]),
		storage.stores.redactor,
	);
	return () => acquired;
}
