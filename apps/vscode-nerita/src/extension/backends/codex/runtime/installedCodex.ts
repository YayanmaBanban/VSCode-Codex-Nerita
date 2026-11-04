// Windows の PATH にある公式 CLI の実体を探し、シェルを介さずバージョンを確認する。
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fsErrorCode } from "../../../runtime/FsError";

const execute = promisify(execFile);

/** npm のエイリアスと旧 vendor 配置を、公式ランチャーと同じ規則で解決する。 */
async function packageExecutable(
	packageJson: string,
): Promise<string | undefined> {
	const root = path.dirname(await realpath(packageJson));
	let vendor = path.join(root, "vendor");
	try {
		const platformJson = createRequire(packageJson).resolve(
			"@openai/codex-win32-x64/package.json",
		);
		vendor = path.join(path.dirname(platformJson), "vendor");
	} catch {
		// 古い配布では CLI パッケージ自身に vendor が含まれる。
	}
	return existingFile(
		path.join(vendor, "x86_64-pc-windows-msvc/bin/codex.exe"),
	);
}

/** 存在しない候補だけを無視し、アクセス拒否や壊れたインストールを隠さない。 */
async function existingFile(file: string): Promise<string | undefined> {
	try {
		const info = await stat(file);
		return info.isFile() ? await realpath(file) : undefined;
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes(fsErrorCode(error) ?? "")) {
			return undefined;
		}
		throw error;
	}
}

/** npm・pnpm の cmd shim は実行せず、既知の Codex JS エントリーだけを取り出す。 */
async function shimExecutable(directory: string): Promise<string | undefined> {
	const shim = await existingFile(path.join(directory, "codex.cmd"));
	if (shim === undefined) {
		return undefined;
	}
	const content = await readFile(shim, "utf8");
	const entries = content.matchAll(
		/"([^"\r\n]*[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js)"/g,
	);
	for (const entry of entries) {
		const file = entry[1]!.replace(/%~dp0|%dp0%/gi, directory);
		if (file.includes("%") || !path.isAbsolute(file)) {
			continue;
		}
		const json = await existingFile(
			path.join(path.dirname(file), "../package.json"),
		);
		if (json !== undefined) {
			return packageExecutable(json);
		}
	}
	return undefined;
}

/** PATH 内の相対パスは探索せず、ワークスペース内の同名コマンドを自動実行しない。 */
export async function findInstalledCodex(
	searchPath = process.env.PATH ?? "",
): Promise<string | undefined> {
	for (const entry of searchPath.split(path.delimiter)) {
		const directory = entry.replace(/^"|"$/g, "");
		if (!path.isAbsolute(directory)) {
			continue;
		}
		const executable = await existingFile(
			path.join(directory, "codex.exe"),
		);
		if (executable !== undefined) {
			return executable;
		}
		const shim = await shimExecutable(directory);
		if (shim !== undefined) {
			return shim;
		}
	}
	return undefined;
}

/** 設定・認証を変更するコマンドを使わず、実行される本体の版を確認する。 */
export async function codexVersion(executable: string): Promise<string> {
	const env = { ...process.env };
	delete env.NODE_OPTIONS;
	delete env.ELECTRON_RUN_AS_NODE;
	const { stdout } = await execute(executable, ["--version"], {
		cwd: path.dirname(executable),
		env,
		windowsHide: true,
		timeout: 10000,
		maxBuffer: 4096,
	});
	const version = /^codex-cli (\d+\.\d+\.\d+)\s*$/.exec(stdout.trim())?.[1];
	if (version === undefined) {
		throw new Error(
			"Codex のバージョンを確認できません。安定版 CLI をインストールしてください。",
		);
	}
	return version;
}
