// 同梱 Codex の CLI と App Server に同一の有限読取り設定を渡す。
import { build } from "esbuild";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** 本番の通信処理とバイナリ解決を、独立した検証用に読み込む。 */
export async function loadRuntime(out) {
	const outfile = path.join(out, "runtime.mjs");
	await build({
		stdin: {
			contents: [
				'export { resolveCodexExecutable } from "./src/extension/backends/codex/runtime/executable";',
				'export { AppServerTransport } from "./src/extension/backends/codex/runtime/AppServerTransport";',
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		outfile,
	});
	return import(pathToFileURL(outfile).href);
}

/** 起動失敗と終了コードを区別し、CLI の拒否結果も保存する。 */
export async function runFile(executable, args, cwd) {
	try {
		const result = await promisify(execFile)(executable, args, {
			cwd,
			windowsHide: true,
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
		});
		return { exitCode: 0, ...result };
	} catch (error) {
		if (typeof error.code !== "number" || error.killed) {
			throw error;
		}
		return {
			exitCode: error.code,
			stdout: error.stdout,
			stderr: error.stderr,
		};
	}
}

/** 設定ファイルを変更せず、専用プロセスだけにプロファイルを適用する。 */
export function profileArgs(cwd, rootAccess) {
	return [
		"-c",
		'windows.sandbox="elevated"',
		"-c",
		'default_permissions="nerita_read_smoke"',
		"-c",
		`permissions.nerita_read_smoke.filesystem={ ":root"="${rootAccess}", ":minimal"="read", ${JSON.stringify(cwd.replaceAll("\\", "/"))}="write" }`,
		"-c",
		"permissions.nerita_read_smoke.network.enabled=false",
	];
}

/** 旧 sandboxPolicy を指定せず、設定から解決した有限読取りを使う。 */
export async function connectRuntime(runtime, executable, cwd, args) {
	const child = spawn(
		executable,
		["app-server", "--listen", "stdio://", ...args],
		{
			cwd,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const transport = new runtime.AppServerTransport(child);
	try {
		await transport.request("initialize", {
			clientInfo: { name: "nerita_read_boundary", version: "0.0.1" },
			capabilities: { experimentalApi: true },
		});
		transport.notify({ method: "initialized" });
		return transport;
	} catch (error) {
		await transport.dispose();
		throw error;
	}
}
