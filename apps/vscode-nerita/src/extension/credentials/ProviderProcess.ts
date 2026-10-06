// Provider CLI は Host の固定 argv と最小環境で実行し、失敗の標準出力を例外へ含めない。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import { spawn, execFile } from "node:child_process";
import { realpath, mkdtemp, rm } from "node:fs/promises";
import { delimiter, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { commandEnvironment } from "../runtime/CommandEnvironment";

export type ProviderProcess = (
	name: "git" | "bws",
	args: string[],
	workspace: string,
	signal: AbortSignal,
	input?: string,
	extraEnv?: Record<string, string>,
) => Promise<string>;
/** PATH 上でもワークスペース内の実行ファイルは資格情報 Provider として起動しない。 */
export async function providerExecutable(
	name: "git" | "bws" | "node",
	workspace: string,
): Promise<string | undefined> {
	const root = await realpath(workspace);
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (!isAbsolute(directory)) {
			continue;
		}
		try {
			const file = await realpath(
				join(
					directory,
					process.platform === "win32" ? `${name}.exe` : name,
				),
			);
			const local = relative(root, file);
			if (
				local === "" ||
				(!local.startsWith("..") && !isAbsolute(local))
			) {
				continue;
			}
			return file;
		} catch {
			/* PATH の未導入候補は飛ばす。資格情報ソースの切替は行わない。 */
		}
	}
	return undefined;
}

/** 取得途中の停止と出力上限でも値を公開せず、シェルを経由しない。 */
export const runProviderProcess: ProviderProcess = async (
	name,
	args,
	workspace,
	signal,
	input,
	extraEnv,
) => {
	signal.throwIfAborted();
	const executable = await providerExecutable(name, workspace);
	if (!isNonEmptyString(executable)) {
		throw new Error(`${name} が導入されていません。`);
	}
	const env = Object.fromEntries(
		Object.entries(commandEnvironment()).filter(
			(entry): entry is [string, string] => entry[1] !== null,
		),
	);
	const directory = await mkdtemp(join(tmpdir(), "nerita-provider-"));
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = spawn(executable, args, {
				cwd: directory,
				env: { ...env, ...extraEnv },
				shell: false,
				windowsHide: true,
				stdio: "pipe",
			});
			let output = "";
			let failed = false;
			const stop = () => {
				if (failed) {
					return;
				}
				failed = true;
				stopProvider(child);
			};
			const timer = setTimeout(stop, 30_000);
			signal.addEventListener("abort", stop, { once: true });
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
				if (failed) {
					return;
				}
				output += chunk;
				if (Buffer.byteLength(output) > 256 * 1024) {
					stop();
				}
			});
			child.stderr.resume();
			child.on("error", stop);
			child.once("close", (code) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", stop);
				if (failed || signal.aborted || code !== 0) {
					reject(
						new Error(
							"資格情報 Provider の取得に失敗しました。認証とアクセス権を確認してください。",
						),
					);
				} else {
					resolve(output);
				}
				output = "";
			});
			child.stdin.on("error", stop);
			child.stdin.end(input ?? "");
			if (signal.aborted) {
				stop();
			}
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};
/** Provider のヘルパーも終了してから一時領域を削除する。 */
function stopProvider(child: ReturnType<typeof spawn>) {
	if (
		process.platform !== "win32" ||
		!isNonEmptyString(process.env.SystemRoot) ||
		!isNonZeroNumber(child.pid)
	) {
		child.kill();
		return;
	}
	execFile(
		join(process.env.SystemRoot, "System32/taskkill.exe"),
		["/PID", String(child.pid), "/T", "/F"],
		{ windowsHide: true, timeout: 5000 },
		() => {
			if (child.exitCode === null) {
				child.kill();
			}
		},
	);
}
