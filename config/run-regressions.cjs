// 通常実装の成功と、指定した実装破壊によるアサーション失敗を対で確認する。
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { runPnpm } = require("./run-pnpm.cjs");
const { repoRoot } = require("./workspace-paths.cjs");
const { bundlePi } = require("./package-pi.cjs");
const { withTestDirectory, runVitest } = require("./test-process.cjs");
const cases = require("./regression-cases.json");

/** 対象を絞って新規プロセスで実行し、ゼロ件や準備失敗を拒否する。 */
async function runCase(directory, mutation, broken) {
	const report = path.join(directory, `${mutation.id}-${broken}.json`);
	const marker = path.join(directory, `${mutation.id}.txt`);
	const env = {
		...process.env,
		NERITA_TEST_PI_ENTRY: path.join(directory, "dist/runtime/pi.mjs"),
	};
	delete env.NERITA_TEST_MUTATION;
	delete env.NERITA_TEST_MUTATION_MARKER;
	if (broken) {
		Object.assign(env, {
			NERITA_TEST_MUTATION: mutation.id,
			NERITA_TEST_MUTATION_MARKER: marker,
		});
	}
	const result = runVitest(
		[
			mutation.test,
			"-t",
			mutation.name,
			"--reporter=json",
			"--outputFile",
			report,
		],
		env,
		true,
	);
	const data = JSON.parse(await readFile(report, "utf8"));
	const assertions = data.testResults
		.flatMap((suite) => suite.assertionResults)
		.filter((item) => item.fullName.includes(mutation.name));
	if (!assertions.length || data.numRuntimeErrorTestSuites > 0) {
		throw new Error(`Tests did not run: ${mutation.id}`);
	}
	if (broken && (await readFile(marker, "utf8")) !== mutation.id) {
		throw new Error(`Mutation not applied: ${mutation.id}`);
	}
	return { result, assertions };
}

/** 別テストの失敗や実行時例外を、指定した回帰の検出へ数えない。 */
async function verifyCase(directory, mutation) {
	const baseline = await runCase(directory, mutation, false);
	if (
		baseline.result.status !== 0 ||
		!baseline.assertions.every((item) => item.status === "passed")
	) {
		throw new Error(
			`Baseline failed: ${mutation.id}\n${JSON.stringify(baseline)}`,
		);
	}
	const broken = await runCase(directory, mutation, true);
	const detected = broken.assertions.every(
		(item) =>
			item.status === "failed" &&
			item.failureMessages.some((message) =>
				/AssertionError/.test(message),
			),
	);
	if (
		broken.result.status !== 1 ||
		broken.assertions.length !== baseline.assertions.length ||
		!detected
	) {
		throw new Error(
			`Regression not detected by its assertions: ${mutation.id}\n${JSON.stringify(broken)}`,
		);
	}
	console.log(
		`[regression] DETECTED ${mutation.id} (${broken.assertions.length} tests)`,
	);
}

/** 保存したケースを日常の入口から再検証し、読み込む製品ファイルは変更しない。 */
async function main(directory) {
	const started = performance.now();
	runPnpm(["build:shared"]);
	await bundlePi(repoRoot, path.join(directory, "dist/runtime"));
	for (const mutation of cases) {
		await verifyCase(directory, mutation);
	}
	console.log(
		`[regression] PASS (${((performance.now() - started) / 1000).toFixed(1)}s)`,
	);
}

void withTestDirectory(main).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
