// 段階導入の対象外も同じ基準で検査し、残る可読性の診断を可視化する。
const { ESLint } = require("eslint");
const { repoRoot } = require("../workspace-paths.cjs");

/** 既存のパーサー・除外範囲を使い、診断結果は独自ルールに絞る。 */
async function audit() {
	const patterns = [
		"apps/**/src/**/*.{ts,tsx}",
		"packages/shared/src/**/*.ts",
	];
	const rules = {
		"nerita/no-complex-boolean-expression": "error",
		"nerita/no-nested-ternary-expression": "error",
		"nerita/no-complex-inline-callback": "error",
		"nerita/no-await-in-condition": "error",
		"nerita/no-multiline-if-condition": "error",
		"nerita/require-member-function-comment": "error",
		// 独自ルールが直接のネストも検査する。
		"no-nested-ternary": "off",
	};
	const eslint = new ESLint({
		cwd: repoRoot,
		overrideConfig: [{ files: patterns, rules }],
	});
	const results = await eslint.lintFiles(patterns);
	const counts = new Map();
	for (const result of results) {
		// 構文解析の失敗は検出数ゼロと区別し、検査に失敗したことを示す。
		result.messages = result.messages.filter(
			(message) => message.fatal || message.ruleId?.startsWith("nerita/"),
		);
		result.errorCount = result.messages.length;
		result.warningCount = 0;
		for (const message of result.messages) {
			const name = message.ruleId ?? "parser";
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	const formatter = await eslint.loadFormatter("stylish");
	console.log(formatter.format(results));
	console.log("可読性の全体検査:", Object.fromEntries(counts));
	if (counts.size > 0) {
		process.exitCode = 1;
	}
}

void audit().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
