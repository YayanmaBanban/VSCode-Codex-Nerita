// 対象リポジトリの用語設定と、非コメント部分をレビューだけで扱うパスを読み込む。
import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

/** 設定がなければ用語の追加指定なしで全ソースの文言を検査し、不正な設定やリンクは拒否する。 */
export async function loadTextlintProject(root) {
	const file = path.join(root, ".textlint-project.json");
	let config;
	try {
		const stat = await fs.lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error(".textlint-project.json must be a regular file");
		}
		config = JSON.parse(await fs.readFile(file, "utf8"));
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
		config = {};
	}
	validateConfig(config);
	const allowedEnglish = readStringArray(config, "allowedEnglish");
	const preferredJapanese = readPreferredJapanese(config);
	const matcher = ignore().add(
		readStringArray(config, "reviewOnlySourceTexts"),
	);
	return {
		terms: { allowedEnglish, preferredJapanese },
		reviewOnlySourceTexts: (file) =>
			matcher.ignores(file.replaceAll("\\", "/")),
	};
}

/** 設定の書き間違いを無視せず、プロジェクトで管理する項目だけを受け付ける。 */
function validateConfig(config) {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error(".textlint-project.json must contain an object");
	}
	const keys = new Set([
		"allowedEnglish",
		"preferredJapanese",
		"reviewOnlySourceTexts",
	]);
	if (Object.keys(config).some((key) => !keys.has(key))) {
		throw new Error("Unknown .textlint-project.json setting");
	}
}

/** 用語とレビュー対象のパターンを、空文字列や改行を含まない文字列配列として読み込む。 */
function readStringArray(config, key) {
	const values = config[key] === undefined ? [] : config[key];
	if (
		!Array.isArray(values) ||
		values.some(
			(value) =>
				typeof value !== "string" ||
				!value.trim() ||
				/[\r\n]/u.test(value),
		)
	) {
		throw new Error(
			`${key} must be an array of non-empty single-line strings`,
		);
	}
	return values;
}

/** 推奨表記を空でない語と文字列の対応として読み込む。 */
function readPreferredJapanese(config) {
	const values =
		config.preferredJapanese === undefined ? {} : config.preferredJapanese;
	if (!values || typeof values !== "object" || Array.isArray(values)) {
		throw new Error("preferredJapanese must contain an object");
	}
	if (
		Object.entries(values).some(
			([term, text]) =>
				!term.trim() || typeof text !== "string" || !text.trim(),
		)
	) {
		throw new Error(
			"preferredJapanese must map non-empty terms to non-empty strings",
		);
	}
	return values;
}
