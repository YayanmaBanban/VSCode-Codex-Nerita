// 選択した Host 検証を、新規プロセスと実行専用の SDK から起動する。
const path = require("node:path");
const { runPnpm } = require("./run-pnpm.cjs");
const { repoRoot } = require("./workspace-paths.cjs");
const { bundlePi } = require("./package-pi.cjs");
const { withTestDirectory, runVitest } = require("./test-process.cjs");

/** 未指定時は全 Host 検証、指定時は対象のファイルまたは領域だけを実行する。 */
async function main(directory) {
	const args = process.argv.slice(2).filter((arg) => arg !== "--");
	const started = performance.now();
	let stage = "prepare";
	try {
		runPnpm(["build:shared"]);
		// 全件実行と結合検証では、過去の dist を参照せず配布経路から生成する。
		const needsSdk =
			!args.length ||
			!args.every((arg) => /^tests\/(unit|contract)(\/|$)/.test(arg));
		const env = { ...process.env };
		delete env.NERITA_TEST_PI_ENTRY;
		delete env.NERITA_TEST_MUTATION;
		delete env.NERITA_TEST_MUTATION_MARKER;
		if (needsSdk) {
			const runtime = path.join(directory, "dist/runtime");
			await bundlePi(repoRoot, runtime);
			env.NERITA_TEST_PI_ENTRY = path.join(runtime, "pi.mjs");
		}
		stage = "tests";
		const result = runVitest(args, env);
		if (result.status !== 0) {
			throw new Error(
				`Vitest failed (${result.status ?? result.signal})`,
			);
		}
		console.log(
			`[host] PASS (${((performance.now() - started) / 1000).toFixed(1)}s)`,
		);
	} catch (error) {
		console.error(
			`[host] ${stage === "prepare" ? "PREPARATION FAILED; TESTS NOT RUN" : "FAIL"}`,
			error,
		);
		process.exitCode = 1;
	}
}

void withTestDirectory(main).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
