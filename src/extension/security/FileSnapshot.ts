// 承認したファイルと既存祖先の同一性を保持する。Host検査はOS Sandboxと同じ競合耐性を保証しない。
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type WorkspacePathPolicy } from "./WorkspacePathPolicy";

/** 既存祖先の入替えを検出し、ディレクトリ内の無関係な変更は許容する。 */
type Entry = { path: string; dev: number; ino: number; birthtimeMs: number };
/** 内容も比較し、同じpathへ差し替えたファイルの上書きを防ぐ。 */
export type FileSnapshot = {
	input: string;
	path: string;
	ancestors: Entry[];
	file: (Entry & { digest: string; nlink: number }) | null;
};

/** 承認前に対象をcanonical化し、内容と既存祖先をコピーする。 */
export async function snapshotFile(
	paths: WorkspacePathPolicy,
	input: string,
): Promise<FileSnapshot> {
	const path = await paths.resolve(input, "write");
	const ancestors: Entry[] = [];
	for (const start of new Set([
		dirname(resolve(paths.cwd, input)),
		dirname(path),
	])) {
		let current = start;
		while (true) {
			const entry = await existingEntry(current);
			if (entry) {
				ancestors.push(entry);
			}
			const parent = dirname(current);
			if (parent === current) {
				break;
			}
			current = parent;
		}
	}
	let file: FileSnapshot["file"] = null;
	try {
		const info = await lstat(path);
		file = {
			path,
			dev: info.dev,
			ino: info.ino,
			birthtimeMs: info.birthtimeMs,
			nlink: info.nlink,
			digest: createHash("sha256")
				.update(await readFile(path))
				.digest("hex"),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
	return { input, path, ancestors, file };
}

/** 新規祖先だけを省き、権限不足等は拒否する。 */
async function existingEntry(path: string): Promise<Entry | undefined> {
	try {
		const info = await lstat(path);
		return {
			path,
			dev: info.dev,
			ino: info.ino,
			birthtimeMs: info.birthtimeMs,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		return undefined;
	}
}

/** 自分で作成した新規親ディレクトリは許容し、承認時にあった祖先と対象を再検査する。 */
export async function verifyFileSnapshot(
	paths: WorkspacePathPolicy,
	snapshot: FileSnapshot,
): Promise<void> {
	const current = await snapshotFile(paths, snapshot.input);
	if (
		current.path !== snapshot.path ||
		JSON.stringify(current.file) !== JSON.stringify(snapshot.file) ||
		snapshot.ancestors.some(
			(entry) =>
				!current.ancestors.some(
					(now) => JSON.stringify(now) === JSON.stringify(entry),
				),
		)
	) {
		throw new Error(
			"承認中にファイルまたは祖先が変更されました。再承認が必要です。",
		);
	}
}
