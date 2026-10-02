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

/** 指定されたパスを検査対象として検証し、リポジトリ相対の情報に変換する。 */
async function resolveTarget(root, rawTarget) {
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
			throw new Error(`textlint target does not exist: ${rawTarget}`, {
				cause: error,
			});
		}

		throw error;
	}

	if (stat.isSymbolicLink()) {
		throw new Error(
			`textlint target must not be a symbolic link: ${rawTarget}`,
		);
	}

	let kind;
	if (stat.isDirectory()) {
		kind = "directory";
	} else if (stat.isFile()) {
		kind = "file";
	} else {
		throw new Error(
			`textlint target must be a file or directory: ${rawTarget}`,
		);
	}

	return { path: normalizePath(relativePath), kind };
}

/**
 * コマンド引数のファイル・フォルダを、リポジトリ相対の検査対象へ変換する。
 */
export async function resolveTextlintTargets(root, rawTargets) {
	const targets = [];
	const seen = new Set();

	for (const rawTarget of rawTargets) {
		// 引数の区切りとして渡された `--` は、検査対象に含めない。
		if (rawTarget === "--") {
			continue;
		}

		const target = await resolveTarget(root, rawTarget);
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

/**
 * 変更ファイル用のモードでは、対象パスが明示されていないときだけ Git の変更ファイルへ絞る。
 *
 * ファイル・フォルダが明示された場合は、その指定を優先して変更状態に関係なく検査する。
 */
export function shouldUseChangedFiles(changed, targets) {
	return changed && targets.length === 0;
}
