// 初期対応する4ツールの依存を `ResourcePolicy` へ変換する。起動用ラッパーは実行せず、限定した形式だけを読む。
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { DevToolProfile } from "./DevToolPolicy";
import { requireInstallDirectory, toolResource } from "./DevToolDiscovery";

/** ツール固有の構造はここに閉じ、ポリシー型へ言語名を追加しない。 */
export const initialDevToolProfiles: readonly DevToolProfile[] = [
	{
		name: "node",
		commands: ["node.exe"],
		resolve: (executable) => [
			toolResource(
				"install",
				requireInstallDirectory(dirname(executable)),
				"node",
				"profile",
			),
		],
	},
	{
		name: "powershell",
		commands: ["powershell.exe", "pwsh.exe", "cmd.exe"],
		resolve: (executable) => [
			toolResource(
				"install",
				executable,
				basename(executable),
				"profile",
			),
		],
	},
	{ name: "git", commands: ["git.exe"], resolve: gitResources },
	{
		name: "pnpm",
		commands: ["pnpm.exe", "pnpm.cmd"],
		resolve: pnpmResources,
	},
];

/** Git for Windows の DLL・libexec を含める。利用者の .gitconfig は取り込まない。 */
async function gitResources(executable: string) {
	const directory = dirname(executable);
	const root = ["cmd", "bin"].includes(basename(directory).toLowerCase())
		? dirname(directory)
		: directory;
	const installation = requireInstallDirectory(root);
	const resources = [toolResource("install", installation, "git", "profile")];
	for (const relative of ["mingw64/libexec/git-core", "usr/bin"]) {
		const helper = join(installation, relative);
		if (await exists(helper)) {
			resources.push(
				toolResource(
					"helper",
					await realpath(helper),
					"git",
					"profile",
				),
			);
		}
	}
	return resources;
}

/** `pnpm setup` の実行ファイルと npm の `pnpm.cjs` を、起動用ラッパーの固定パターンから解決する。 */
async function pnpmResources(executable: string) {
	if (!executable.toLowerCase().endsWith(".cmd")) {
		return [toolResource("install", executable, "pnpm", "profile")];
	}
	const text = await readFile(executable, "utf8");
	if (text.length > 16_384) {
		throw new Error("pnpm shim が大きすぎます。");
	}
	const match = text.match(/%~dp0([^"\r\n]*pnpm\.exe)"/i);
	const candidate = match
		? resolve(dirname(executable), `.${match[1]}`)
		: join(dirname(executable), "node_modules/pnpm/bin/pnpm.cjs");
	if (!(await exists(candidate))) {
		return [];
	}
	const target = await realpath(candidate);
	const install = target.endsWith(".cjs")
		? dirname(dirname(target))
		: dirname(target);
	return [
		toolResource(
			"install",
			requireInstallDirectory(dirname(executable)),
			"pnpm",
			"profile",
		),
		toolResource("helper", target, "pnpm", "profile"),
		toolResource(
			"install",
			requireInstallDirectory(install),
			"pnpm",
			"profile",
		),
	];
}

/** 未導入の任意依存は許可リストへ追加しない。 */
async function exists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
