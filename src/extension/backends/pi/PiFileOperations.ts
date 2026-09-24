// SDKのファイルI/Oをworkspace policyで検査し、画像判定にも同じ境界を適用する。
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname } from "node:path";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { windowsFileOperation } from "../../runtime/WindowsFileBroker";

/** 同時実行するTool間で承認した対象を混同しない。 */
type FileExecution = { signal: AbortSignal; path: string; tool: string };
const executions = new AsyncLocalStorage<FileExecution>();
/** SDKの非同期I/Oへ承認したパス・Tool種別・Stopをまとめて伝播する。 */
export function withApprovedFileCall<T>(
	signal: AbortSignal,
	path: string,
	tool: string,
	execute: () => T,
): T {
	return executions.run(Object.freeze({ signal, path, tool }), execute);
}

/** 同じpolicyからread・write・画像判定を生成する。 */
export function piFileOperations(
	paths: WorkspacePathPolicy,
	lifetime: AbortSignal,
) {
	const run = (
		operation: Parameters<typeof windowsFileOperation>[1],
		path: string,
		content?: string,
	) => {
		const execution = executions.getStore();
		if (!execution) {
			throw new Error("承認済みファイル操作の実行範囲がありません。");
		}
		assertApprovedPath(execution, operation, path);
		return windowsFileOperation(
			paths,
			operation,
			path,
			AbortSignal.any([execution.signal, lifetime]),
			content,
		);
	};
	const readFile = async (path: string) => {
		return Buffer.from((await run("read", path)) as string, "base64");
	};
	const access = async (path: string) => {
		await run("stat", path);
	};
	const writeFile = async (path: string, content: string) => {
		await run("write", path, content);
	};
	const detectImageMimeType = async (path: string) => {
		return imageMime(
			Buffer.from((await run("image", path)) as string, "base64"),
		);
	};
	const mkdir = async (path: string) => {
		await run("mkdir", path);
	};
	const stat = async (path: string) => {
		const directory = await run("stat", path);
		return { isDirectory: () => directory === true };
	};
	const readdir = async (path: string) =>
		(await run("list", path)) as string[];
	return {
		readFile,
		access,
		writeFile,
		detectImageMimeType,
		mkdir,
		stat,
		readdir,
	};
}

/** SDKのUnicode変換やreadの別名探索を、承認した実体パスの変更として拒否する。 */
function assertApprovedPath(
	execution: FileExecution,
	operation: Parameters<typeof windowsFileOperation>[1],
	path: string,
) {
	let allowed = path === execution.path;
	if (operation === "mkdir") {
		allowed =
			execution.tool === "write" && path === dirname(execution.path);
	} else if (operation === "write") {
		allowed =
			allowed &&
			(execution.tool === "write" || execution.tool === "edit");
	} else if (execution.tool === "ls" && operation === "stat") {
		// lsは表示対象の直下だけをstatする。別ディレクトリへの列挙は許可しない。
		allowed = allowed || dirname(path) === execution.path;
	}
	if (!allowed) {
		throw new Error(
			"承認済みのファイルパスとI/Oの対象が一致しません。再承認が必要です。",
		);
	}
}

/** 拡張子を信用せず、SDKが対応する画像形式のmagic bytesを確認する。 */
function imageMime(bytes: Buffer): string | undefined {
	const signatures: [string, string][] = [
		["89504e470d0a1a0a", "image/png"],
		["ffd8ff", "image/jpeg"],
		["474946383761", "image/gif"],
		["474946383961", "image/gif"],
		["424d", "image/bmp"],
	];
	const hex = bytes.toString("hex");
	const match = signatures.find(([prefix]) => hex.startsWith(prefix));
	if (match) {
		return match[1];
	}
	return bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
		? "image/webp"
		: undefined;
}
