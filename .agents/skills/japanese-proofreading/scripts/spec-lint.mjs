// 明示された仕様書だけを検査し、文章を変更せず位置付きの警告を保存する。
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createSpecLinter } from "./spec-rules.mjs";
import { createTextlintIgnore } from "./textlint-ignore.mjs";
import { resolveTextlintTargets } from "./textlint-targets.mjs";
import { maskIgnoredDocument } from "./textlint-audit.mjs";

/** 指定範囲だけを探索し、除外設定とリンクの境界を既存の検査と揃える。 */
async function markdownFiles(root, targets) {
	const ignore = createTextlintIgnore(root);
	const files = new Set();
	const walk = async (relative) => {
		const absolute = path.join(root, relative);
		const stat = await fs.lstat(absolute);
		if (stat.isSymbolicLink()) {
			return;
		}
		const directory = stat.isDirectory();
		if (
			relative &&
			(await ignore.ignores(relative + (directory ? "/" : "")))
		) {
			return;
		}
		if (directory) {
			for (const entry of await fs.readdir(absolute)) {
				await walk(path.posix.join(relative, entry));
			}
		} else if (stat.isFile() && /\.(?:md|markdown)$/i.test(relative)) {
			files.add(relative);
		}
	};
	for (const target of targets) {
		if (
			target.kind === "file" &&
			!/\.(?:md|markdown)$/i.test(target.path)
		) {
			throw new Error("spec:lint targets must be Markdown files");
		}
		await walk(target.path);
	}
	return [...files].sort();
}

/** 警告は成功、引数・設定・読込みの失敗は終了コード2として区別する。 */
async function main() {
	const { values, positionals } = parseArgs({
		options: {
			root: { type: "string" },
			"sentence-max": { type: "string" },
			"paragraph-max": { type: "string" },
			"list-item-max": { type: "string" },
			"table-min": { type: "string" },
		},
		allowPositionals: true,
	});
	if (!values.root || !positionals.some((target) => target !== "--")) {
		throw new Error(
			"Usage: spec:lint --root <directory> <Markdown file or directory ...>",
		);
	}
	const root = await fs.realpath(path.resolve(values.root));
	if (!(await fs.stat(root)).isDirectory()) {
		throw new Error("--root must be a directory");
	}
	const targets = await resolveTextlintTargets(root, positionals);
	const overrides = {};
	for (const [flag, key] of Object.entries({
		"sentence-max": "sentenceMax",
		"paragraph-max": "paragraphMax",
		"list-item-max": "listItemMax",
		"table-min": "tableMin",
	})) {
		if (values[flag] !== undefined) {
			overrides[key] = Number(values[flag]);
		}
	}
	const linter = await createSpecLinter(overrides);
	const files = await markdownFiles(root, targets);
	const results = [];
	for (const file of files) {
		const source = await fs.readFile(path.join(root, file), "utf8");
		const result = await linter.lintText(
			maskIgnoredDocument(source, file),
			file,
		);
		results.push({ file, messages: result.messages });
		for (const message of result.messages) {
			console.log(
				`${file}:${message.line}:${message.column}  warning  ${message.ruleId}  ${message.message}`,
			);
		}
	}
	const warningCount = results.reduce(
		(count, result) => count + result.messages.length,
		0,
	);
	const output = path.join(root, ".textlint-cache", "spec-lint.json");
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.writeFile(
		output,
		`${JSON.stringify({ version: 1, files, warningCount, results }, null, 2)}\n`,
		"utf8",
	);
	console.log(
		`spec:lint: ${files.length} file(s), ${warningCount} warning(s). Report: .textlint-cache/spec-lint.json`,
	);
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 2;
});
