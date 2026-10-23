// Git の追跡対象と未追跡ファイルを実測し、dirty な内容も含むスナップショットを発行する。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { DlcPathSchema } from "@nerita/shared/dlc/contracts";
import type { SourceSnapshot } from "@nerita/dlc/runtime";
import { containsPath } from "../security/AgentAccessPolicy";
import { isDlcPath, isDlcKnowledge } from "@nerita/shared/dlc/managedPaths";

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
	const matchesValue = (await realpath(gitRoot)) !== (await realpath(root));
	if (matchesValue) {
		throw new Error("DLC は Git リポジトリのルートで実行してください。");
	}
	const baseCommit = (await git(root, ["rev-parse", "HEAD"], signal)).trim();
	const indexDigest = await stagedDigest(root, signal);
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
				.filter(
					(name) =>
						name !== "" &&
						(!isDlcPath(name) || isDlcKnowledge(name)),
				),
		),
	].sort();
	if (names.length > maxFiles) {
		throw new Error("DLC のソース収集上限を超えています。");
	}
	const files: SourceSnapshot["files"] = [];
	const artifacts: SourceSnapshot["files"] = [];
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
		(isDlcKnowledge(path) ? artifacts : files).push({
			path,
			digest: createHash("sha256").update(file).digest("hex"),
		});
	}
	const id = createHash("sha256")
		.update(JSON.stringify({ baseCommit, indexDigest, files, artifacts }))
		.digest("hex");
	const matchesTrim =
		(await git(root, ["rev-parse", "HEAD"], signal)).trim() !== baseCommit;
	if (matchesTrim) {
		throw new Error("ソースの収集中に基準コミットが変更されました。");
	}
	return { id, baseCommit, indexDigest, complete: true, files, artifacts };
}

/** 指定ルートで Git を時間・出力容量・中断の制限付きで実行し、標準出力を返す。 */
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
/** 存在する通常ファイルだけをルート内から収集し、リンクや領域外への差し替えを拒否する。 */
async function sourceFile(root: string, path: string): Promise<Buffer | null> {
	const target = resolve(root, path);
	let stat;
	try {
		stat = await lstat(target);
	} catch (error) {
		const matchesError =
			error instanceof Error &&
			"code" in error &&
			error.code === "ENOENT";
		if (matchesError) {
			return null;
		}
		throw error;
	}

	if (!stat.isFile()) {
		throw new Error(`収集対象が通常のファイルではありません: ${path}`);
	}
	if (stat.isSymbolicLink()) {
		throw new Error(
			`シンボリックリンクはソースの収集対象にできません: ${path}`,
		);
	}
	const resolvedTarget = await realpath(target);
	if (!containsPath(root, resolvedTarget)) {
		throw new Error(`ソースの参照先がリポジトリの外にあります: ${path}`);
	}
	if (stat.size > maxBytes) {
		throw new Error(`ソース収集容量を超えています: ${path}`);
	}
	return readFile(target);
}

/** DLC の管理領域を除いたステージ済み差分の指紋を計算し、実行対象の変更を識別する。 */
async function stagedDigest(
	root: string,
	signal: AbortSignal,
): Promise<string> {
	return createHash("sha256")
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
					"--",
					".",
					":(exclude,icase).nerita/dlc/**",
				],
				signal,
			),
		)
		.digest("hex");
}
