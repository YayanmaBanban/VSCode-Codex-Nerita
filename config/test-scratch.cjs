// 指定した UI スクラッチだけを、その定義と同じ Playwright Test の CLI で実行する。
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const args = process.argv.slice(2);
if (
	!args.includes("--list") &&
	!args.some((arg) => arg.includes(".spec.cjs"))
) {
	throw new Error(
		"対象の .spec.cjs を指定してください。一覧の確認には pnpm test:scratch --list を使います。",
	);
}

// ルートの playwright と @playwright/test は別バージョンになり得るため、定義側の CLI を使う。
const cli = path.join(
	path.dirname(require.resolve("@playwright/test/package.json")),
	"cli.js",
);
const result = spawnSync(
	process.execPath,
	[cli, "test", "--config", "tests/scratch/playwright.config.cjs", ...args],
	{
		cwd: path.resolve(__dirname, ".."),
		stdio: "inherit",
		windowsHide: true,
		env: { ...process.env, SCRATCH_RUN_ID: randomUUID() },
	},
);
if (result.error) {
	throw result.error;
}
process.exitCode = result.status ?? 1;
