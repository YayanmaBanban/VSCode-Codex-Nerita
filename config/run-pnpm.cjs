// 更新・検証スクリプトから、起動元と同じ pnpm をシェルを介さず実行する。
const { spawnSync } = require("node:child_process");
const path = require("node:path");

/** 起動元の pnpm を確認し、通常版と Windows 単体実行ファイル版の起動引数を返す。 */
function pnpmCommand() {
	const executable = process.env.npm_execpath;
	if (
		!executable ||
		!process.env.npm_config_user_agent?.startsWith("pnpm/")
	) {
		throw new Error("この処理は pnpm のスクリプトとして実行してください。");
	}
	const standalone = path.extname(executable).toLowerCase() === ".exe";
	return standalone ? [executable] : [process.execPath, executable];
}

/** pnpm が失敗したら後続処理を止め、必要な場合だけ標準出力を返す。 */
function runPnpm(args, { captureOutput = false } = {}) {
	const [executable, ...prefix] = pnpmCommand();
	console.log(`pnpm ${args.join(" ")}`);
	const result = spawnSync(executable, [...prefix, ...args], {
		cwd: path.resolve(__dirname, ".."),
		stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`pnpm ${args.join(" ")} が失敗しました (${result.status ?? result.signal})。`,
		);
	}
	return result.stdout;
}

module.exports = { runPnpm };
