// 対象リポジトリの設定から、非コメント部分をレビューだけで扱うパスを選ぶ。
import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

/** 設定がなければ全ソースの文言を検査し、不正な設定やリンクは拒否する。 */
export async function loadSourceTextPolicy(root) {
	const file = path.join(root, ".textlint-policy.json");
	let config;
	try {
		const stat = await fs.lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error(".textlint-policy.json must be a regular file");
		}
		config = JSON.parse(await fs.readFile(file, "utf8"));
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
		config = {};
	}
	const matcher = ignore().add(readSourceTextPatterns(config));
	return (file) => matcher.ignores(file.replaceAll("\\", "/"));
}

/** 設定キーとパターン配列を検証してから照合に渡す。 */
function readSourceTextPatterns(config) {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error(".textlint-policy.json must contain an object");
	}
	if (Object.keys(config).some((key) => key !== "reviewOnlySourceTexts")) {
		throw new Error("Unknown .textlint-policy.json setting");
	}
	const patterns =
		config.reviewOnlySourceTexts === undefined
			? []
			: config.reviewOnlySourceTexts;
	if (
		!Array.isArray(patterns) ||
		patterns.some(
			(pattern) =>
				typeof pattern !== "string" ||
				!pattern.trim() ||
				/[\r\n]/u.test(pattern),
		)
	) {
		throw new Error(
			"reviewOnlySourceTexts must be an array of non-empty gitignore patterns",
		);
	}
	return patterns;
}
