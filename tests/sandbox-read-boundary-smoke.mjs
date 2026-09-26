// 有限読取りの実機検証。起動失敗を読取り拒否の成功として扱わない。
import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
	realpath,
	symlink,
	rm,
} from "node:fs/promises";
import { tmpdir, release } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	loadRuntime,
	runFile,
	profileArgs,
	connectRuntime,
} from "./sandbox-read-boundary-runtime.mjs";

assert.equal(process.platform, "win32", "Windows 実機専用");
assert.equal(process.arch, "x64");
const out = path.resolve("dist/sandbox-read-boundary-smoke");
await mkdir(out, { recursive: true });
const runtime = await loadRuntime(out);
const executable = await runtime.resolveCodexExecutable(process.cwd());
const version = await runFile(executable, ["--version"], process.cwd());
assert.equal(version.stdout.trim(), "codex-cli 0.157.0");
const root = await realpath(
	await mkdtemp(path.join(tmpdir(), "nerita-read-boundary-")),
);
const cwd = path.join(root, "workspace");
const outside = path.join(root, "outside");
const shell = path.join(
	process.env.SystemRoot,
	"System32/WindowsPowerShell/v1.0/powershell.exe",
);
const report = {
	date: new Date().toISOString(),
	codex: version.stdout.trim(),
	binarySha256: createHash("sha256")
		.update(await readFile(executable))
		.digest("hex"),
	binarySource:
		"dist/runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	windows: release(),
	node: process.version,
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	profile: {
		root: "deny",
		minimal: "read",
		workspace: "write",
		network: false,
		backend: "elevated",
	},
	cases: [],
};

/** フィクスチャのパスを PowerShell のリテラルとして引用する。 */
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
/** プロファイルの成功・拒否を機械判定できるマーカーを返す。 */
const command = (code) => [
	shell,
	"-NoLogo",
	"-NoProfile",
	"-NonInteractive",
	"-Command",
	code,
];
/** 絶対パスを記録へ残さず、失敗しても後続の検証を続ける。 */
async function test(id, operation) {
	try {
		const details = await operation();
		report.cases.push({ id, status: "pass", details });
		console.log(`PASS ${id}`);
	} catch (error) {
		let message = error.message;
		for (const [value, label] of [
			[root, "<fixture>"],
			[process.cwd(), "<repo>"],
			[process.env.USERPROFILE, "<user>"],
			[process.env.SystemRoot, "<windows>"],
		]) {
			if (value) {
				message = message
					.replaceAll(value.replaceAll("\\", "\\\\"), label)
					.replaceAll(value, label);
			}
		}
		report.cases.push({ id, status: "fail", error: message });
		console.log(`FAIL ${id}: ${message}`);
	}
}
/** 外部ファイルを本当に開き、権限拒否だけを成功とする。 */
function readProbe(target, denied) {
	return `$ErrorActionPreference='Stop'; Write-Output 'PROBE_STARTED'; try { $v=Get-Content -Raw -LiteralPath ${quote(target)}; Write-Output 'READ_OK'; if ($v -ne 'outside-canary') { exit 12 }; exit ${denied ? 10 : 0} } catch [System.UnauthorizedAccessException] { Write-Output 'READ_DENIED'; exit ${denied ? 0 : 11} }`;
}

try {
	await mkdir(cwd);
	await mkdir(outside);
	const external = path.join(outside, "canary.txt");
	await writeFile(external, "outside-canary");
	await writeFile(path.join(cwd, "inside.txt"), "inside-canary");
	await symlink(outside, path.join(cwd, "linked"), "junction");
	await test("host-control", async () => {
		const result = await runFile(
			shell,
			command(readProbe(external, false)).slice(1),
			cwd,
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /READ_OK/);
	});
	for (const route of ["cli", "command/exec"]) {
		for (const access of ["read", "deny"]) {
			await runProfile(route, access, external);
		}
	}
} finally {
	// 作成した一時ディレクトリだけを削除し、junction の参照先を再帰削除しない。
	assert.equal(path.dirname(root), await realpath(tmpdir()));
	assert.ok(path.basename(root).startsWith("nerita-read-boundary-"));
	await rm(path.join(cwd, "linked"), { force: true });
	await rm(root, { recursive: true, force: true });
	await writeFile(
		path.join(out, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
}
process.exitCode = report.cases.some((entry) => entry.status !== "pass")
	? 1
	: 0;

/** 各経路と権限設定のケースを実行し、接続を必ず回収する。 */
async function runProfile(route, access, external) {
	const args = profileArgs(cwd, access);
	let transport;
	try {
		if (route === "command/exec") {
			transport = await connectRuntime(runtime, executable, cwd, args);
		}
		/** 同じ引数を CLI と App Server の両方へ送る。 */
		const execute = (code) =>
			transport
				? transport.request("command/exec", {
						command: command(code),
						cwd,
						timeoutMs: 15_000,
					})
				: runFile(
						executable,
						[
							"sandbox",
							"-P",
							"nerita_read_smoke",
							...args,
							"-C",
							cwd,
							"--",
							...command(code),
						],
						cwd,
					);
		await test(`${route}/${access}/workspace-read-write`, async () => {
			const result = await execute(
				"$ErrorActionPreference='Stop'; if ((Get-Content -Raw -LiteralPath 'inside.txt') -ne 'inside-canary') { exit 12 }; Set-Content -NoNewline -LiteralPath 'written.txt' -Value 'written'; Write-Output 'WORKSPACE_OK'",
			);
			assert.equal(result.exitCode, 0, JSON.stringify(result));
			assert.match(result.stdout, /WORKSPACE_OK/);
			assert.equal(
				await readFile(path.join(cwd, "written.txt"), "utf8"),
				"written",
			);
		});
		for (const [name, target] of [
			["absolute", external],
			["relative", "../outside/canary.txt"],
			["junction", "linked/canary.txt"],
		]) {
			await test(`${route}/${access}/outside-${name}`, async () => {
				const result = await execute(
					readProbe(target, access === "deny"),
				);
				assert.equal(result.exitCode, 0, JSON.stringify(result));
				assert.match(
					result.stdout,
					access === "deny" ? /READ_DENIED/ : /READ_OK/,
				);
				return {
					outcome: access === "deny" ? "denied" : "readable",
				};
			});
		}
		await test(`${route}/${access}/child-read`, async () => {
			const encoded = Buffer.from(
				readProbe(external, access === "deny"),
				"utf16le",
			).toString("base64");
			const result = await execute(
				`& ${quote(shell)} -NoProfile -NonInteractive -EncodedCommand ${encoded}; exit $LASTEXITCODE`,
			);
			assert.equal(result.exitCode, 0, JSON.stringify(result));
			assert.match(
				result.stdout,
				access === "deny" ? /READ_DENIED/ : /READ_OK/,
			);
		});
		await test(`${route}/${access}/outside-write`, async () => {
			const result = await execute(
				`$ErrorActionPreference='Stop'; try { Set-Content -LiteralPath ${quote(external)} -Value 'bad'; exit 10 } catch [System.UnauthorizedAccessException] { Write-Output 'WRITE_DENIED'; exit 0 }`,
			);
			assert.equal(result.exitCode, 0, JSON.stringify(result));
			assert.match(result.stdout, /WRITE_DENIED/);
			assert.equal(await readFile(external, "utf8"), "outside-canary");
		});
	} catch (error) {
		await test(`${route}/${access}/setup`, () => {
			throw error;
		});
	} finally {
		await transport?.dispose();
	}
}
