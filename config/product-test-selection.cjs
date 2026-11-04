// 製品検証と配布検証で、バックエンドとファイル名による対象選択を共有する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { repoRoot } = require("./workspace-paths.cjs");

/** バックエンド専用のファイルだけを選び、名前未指定の共通・横断テストは全体検証に残す。 */
async function selectProductTests(args) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			backend: { type: "string", default: "all" },
			list: { type: "boolean", default: false },
			external: { type: "boolean", default: false },
			regressions: { type: "boolean", default: false },
		},
	});
	if (!["all", "pi", "codex"].includes(values.backend)) {
		throw new Error(
			"--backend は pi、codex、all のいずれかを指定してください。",
		);
	}
	const backendPattern = new RegExp(`(^|-)${values.backend}(?:-|\\.)`);
	const files = (await fs.readdir(path.join(repoRoot, "tests/product")))
		.filter((name) => name.endsWith(".test.ts"))
		.filter(
			(name) => name.endsWith(".external.test.ts") === values.external,
		)
		.filter((name) => values.backend === "all" || backendPattern.test(name))
		.filter(
			(name) =>
				positionals.length === 0 ||
				positionals.some((selection) => name.includes(selection)),
		);
	if (!files.length) {
		throw new Error("該当する製品検証がありません。");
	}
	return { ...values, files };
}

module.exports = { selectProductTests };
