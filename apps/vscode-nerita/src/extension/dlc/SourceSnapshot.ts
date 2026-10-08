// Git の追跡対象と未追跡ファイルを実測し、dirty な内容も含むスナップショットを発行する。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { DlcPathSchema } from "@nerita/shared/dlc/contracts";
import type { SourceSnapshot } from "@nerita/dlc/runtime";
import { containsPath } from "../security/AgentAccessPolicy";

const execute = promisify(execFile);
const maxFiles = 10000;
const maxBytes = 64 * 1024 * 1024;

/** Git のルート以外や範囲外へのリンクは収集を拒否し、不完全な内容を成功扱いしない。 */
export async function collectSourceSnapshot(
	root: string,
	signal: AbortSignal,
): Promise<SourceSnapshot> {
	const gitRoot = (
		await git(root, ["rev-parse", "--show-toplevel"], signal)
	).trim();
	if ((await realpath(gitRoot)) !== (await realpath(root))) {
		throw new Error("DLC は Git リポジトリのルートで実行してください。");
	}
	const baseCommit = (await git(root, ["rev-parse", "HEAD"], signal)).trim();
	const indexDigest = createHash("sha256")
		.update(
			await git(
				root,
				[
					"diff",
					"--cached",
					"--binary",
					"--no-ext-diff",
					"--no-textconv",
					"HEAD",
				],
				signal,
			),
		)
		.digest("hex");
	const names = [
		...new Set(
			(
				await git(
					root,
					[
						"ls-files",
						"-z",
						"--cached",
						"--others",
						"--exclude-standard",
					],
					signal,
				)
			)
				.split("\0")
				.filter(Boolean),
		),
	].sort();
	if (names.length > maxFiles) {
		throw new Error("DLC のソース収集上限を超えています。");
	}
	const files: SourceSnapshot["files"] = [];
	let bytes = 0;
	for (const name of names) {
		signal.throwIfAborted();
		const path = DlcPathSchema.parse(name);
		const file = await sourceFile(root, path);
		if (file === null) {
			continue;
		}
		bytes += file.length;
		if (bytes > maxBytes) {
			throw new Error("DLC のソース収集容量を超えています。");
		}
		files.push({
			path,
			digest: createHash("sha256").update(file).digest("hex"),
		});
	}
	const id = createHash("sha256")
		.update(JSON.stringify({ baseCommit, indexDigest, files }))
		.digest("hex");
	if (
		(await git(root, ["rev-parse", "HEAD"], signal)).trim() !== baseCommit
	) {
		throw new Error("ソースの収集中に基準コミットが変更されました。");
	}
	return { id, baseCommit, indexDigest, complete: true, files };
}

async function git(
	root: string,
	args: string[],
	signal: AbortSignal,
): Promise<string> {
	const result = await execute("git", ["-C", root, ...args], {
		signal,
		windowsHide: true,
		maxBuffer: 8 * 1024 * 1024,
		timeout: 30000,
	});
	return result.stdout;
}
async function sourceFile(root: string, path: string): Promise<Buffer | null> {
	const target = resolve(root, path);
	let stat;
	try {
		stat = await lstat(target);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return null;
		}
		throw error;
	}
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		!containsPath(root, await realpath(target))
	) {
		throw new Error(`ソースを安全に収集できません: ${path}`);
	}
	if (stat.size > maxBytes) {
		throw new Error(`ソース収集容量を超えています: ${path}`);
	}
	return readFile(target);
}
