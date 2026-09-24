// 自動コンテキストもworkspace境界とWin32 brokerを通し、SDKの直接読込みを使わない。
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	containsPath,
	policyWorkspaceRoots,
} from "../../security/AgentAccessPolicy";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { windowsFileOperation } from "../../runtime/WindowsFileBroker";

/** 内容と出典の検査結果を同じsnapshotに保つ。 */
type ContextFile = { path: string; content: string };
/** SDKへ内容を直接渡すための読込み結果。 */
export type PiContextFiles = {
	agentsFiles: ContextFile[];
	system: ContextFile | undefined;
	append: ContextFile | undefined;
};

/** workspace内の祖先だけを対象にし、global設定領域やdrive rootへ探索を広げない。 */
export async function loadPiContextFiles(
	paths: WorkspacePathPolicy,
	signal: AbortSignal,
): Promise<PiContextFiles> {
	const cwd = await paths.resolveWorkspace(paths.cwd);
	const directories: string[] = [];
	for (
		let directory = cwd;
		policyWorkspaceRoots(paths.policy).some((root) =>
			containsPath(root, directory),
		);
		directory = dirname(directory)
	) {
		directories.unshift(directory);
		if (dirname(directory) === directory) {
			break;
		}
	}
	const agentsFiles: ContextFile[] = [];
	for (const directory of directories) {
		for (const name of [
			"AGENTS.override.md",
			"AGENTS.md",
			"AGENTS.MD",
			"CLAUDE.md",
			"CLAUDE.MD",
		]) {
			const file = await readContextFile(
				paths,
				join(directory, name),
				signal,
			);
			if (file) {
				agentsFiles.push(file);
				break;
			}
		}
	}
	return {
		agentsFiles,
		system: await readContextFile(
			paths,
			join(cwd, ".pi/SYSTEM.md"),
			signal,
		),
		append: await readContextFile(
			paths,
			join(cwd, ".pi/APPEND_SYSTEM.md"),
			signal,
		),
	};
}

/** 存在しない候補だけを省略し、保護対象・リンク・読取り失敗は起動失敗にする。 */
async function readContextFile(
	paths: WorkspacePathPolicy,
	input: string,
	signal: AbortSignal,
): Promise<ContextFile | undefined> {
	signal.throwIfAborted();
	try {
		// 存在確認は最適化だけ。内容を読む直前にはbrokerで再度境界を固定する。
		await lstat(input);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	const path = await paths.resolveWorkspace(input);
	const encoded = await windowsFileOperation(paths, "read", path, signal);
	return {
		path,
		content: Buffer.from(encoded as string, "base64")
			.toString("utf8")
			.replace(/^\uFEFF/, ""),
	};
}
