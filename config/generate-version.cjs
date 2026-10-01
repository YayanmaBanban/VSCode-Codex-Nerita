// 生成コマンドの指定版、または pnpm のレジストリで公開された最新版を解決する。
const { runPnpm } = require("./run-pnpm.cjs");

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** 最新版は一度だけ解決し、すべての依存更新に同じ固定バージョンを渡す。 */
function readRequestedVersion(packageName, command) {
	const args = process.argv.slice(2);
	if (args[0] === "--") {
		args.shift();
	}
	const requested = args[0];
	if (
		args.length > 1 ||
		(requested !== undefined &&
			requested !== "--latest" &&
			!versionPattern.test(requested))
	) {
		throw new Error(`使い方: pnpm ${command} [バージョン | --latest]`);
	}
	if (requested !== "--latest") {
		return requested;
	}
	const output = runPnpm(
		["view", packageName, "dist-tags.latest", "--json"],
		{
			captureOutput: true,
		},
	);
	const version = JSON.parse(output);
	if (typeof version !== "string" || !versionPattern.test(version)) {
		throw new Error(
			`${packageName} の latest タグからバージョンを取得できません。`,
		);
	}
	console.log(`${packageName} の最新版: ${version}`);
	return version;
}

module.exports = { readRequestedVersion };
