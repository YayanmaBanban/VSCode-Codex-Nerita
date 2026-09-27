import fs from "node:fs/promises";
import path from "node:path";

function normalizePath(filePath) {
	return filePath.split(path.sep).join("/");
}

function isOutsideRoot(relativePath) {
	return (
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	);
}

/**
 * コマンド引数のファイル・フォルダを、リポジトリ相対の検査対象へ変換する。
 */
export async function resolveTextlintTargets(root, rawTargets) {
	const targets = [];
	const seen = new Set();

	for (const rawTarget of rawTargets) {
		const absolutePath = path.resolve(root, rawTarget);
		const relativePath = path.relative(root, absolutePath);

		if (isOutsideRoot(relativePath)) {
			throw new Error(`textlint target is outside repository: ${rawTarget}`);
		}

		let stat;

		try {
			stat = await fs.lstat(absolutePath);
		} catch (error) {
			if (error?.code === "ENOENT") {
				throw new Error(`textlint target does not exist: ${rawTarget}`);
			}

			throw error;
		}

		if (stat.isSymbolicLink()) {
			throw new Error(`textlint target must not be a symbolic link: ${rawTarget}`);
		}

		const kind = stat.isDirectory()
			? "directory"
			: stat.isFile()
				? "file"
				: null;

		if (!kind) {
			throw new Error(`textlint target must be a file or directory: ${rawTarget}`);
		}

		const target = {
			path: normalizePath(relativePath),
			kind,
		};
		const key = `${target.kind}:${target.path}`;

		if (!seen.has(key)) {
			seen.add(key);
			targets.push(target);
		}
	}

	return targets;
}

/**
 * 検査候補を指定されたファイル・フォルダ内へ絞り込む。
 */
export function filterFilesByTargets(files, targets) {
	if (targets.length === 0) {
		return files;
	}

	return files.filter((file) =>
		targets.some((target) => {
			if (target.path === "") {
				return true;
			}

			if (target.kind === "file") {
				return file === target.path;
			}

			return file === target.path || file.startsWith(`${target.path}/`);
		}),
	);
}
