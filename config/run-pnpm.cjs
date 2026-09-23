// 更新・検証スクリプトから、起動元と同じpnpmをシェルを介さず実行する。
const { spawnSync } = require("node:child_process");
const path = require("node:path");

/** 通常版とWindows単体exe版に対応し、失敗時は後続処理を止める。 */
function runPnpm(args) {
	const executable = process.env.npm_execpath;
	if (
		!executable ||
		!process.env.npm_config_user_agent?.startsWith("pnpm/")
	) {
		throw new Error("この処理は pnpm のスクリプトとして実行してください。");
	}
	const standalone = path.extname(executable).toLowerCase() === ".exe";
	console.log(`pnpm ${args.join(" ")}`);
	const result = spawnSync(
		standalone ? executable : process.execPath,
		[...(standalone ? [] : [executable]), ...args],
		{
			cwd: path.resolve(__dirname, ".."),
			stdio: "inherit",
			windowsHide: true,
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`pnpm ${args.join(" ")} が失敗しました (${result.status ?? result.signal})。`,
		);
	}
}

module.exports = { runPnpm };
