// 回帰検出器の本体に異常な実行結果を渡し、準備失敗や無関係な失敗を検出成功に数えないことを検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

void test("回帰検出は目的のテストとアサーションだけを認定し、準備例外と stderr の障害を拒否する", async () => {
	const source = await readFile(
		join(process.env.NERITA_TEST_REPO_ROOT!, "config/test-products.cjs"),
		"utf8",
	);
	const functions = source.slice(
		source.indexOf("function verifyRegression("),
		source.indexOf("/** 選んだ領域"),
	);
	const verify = runInNewContext(`${functions}\nverifyRegression`, {
		regressions: {
			fixture: {
				expected: [
					{ test: "仕様の検証", messages: ["目的のアサーション"] },
				],
			},
		},
		console: { log() {}, error() {} },
	}) as (
		result: {
			status: number | null;
			signal?: string;
			stdout: string;
			stderr: string;
		},
		name: string,
	) => void;
	const failure = {
		name: "仕様の検証",
		code: "ERR_ASSERTION",
		type: "testCodeFailure",
		message: "目的のアサーション",
	};
	const result = { status: 1, stdout: JSON.stringify(failure), stderr: "" };
	assert.doesNotThrow(() => verify(result, "fixture"));
	for (const invalid of [
		{ ...result, status: 0 },
		{ ...result, status: null, signal: "SIGTERM" },
		{ ...result, stdout: "" },
		{ ...result, stderr: "SyntaxError: fixture failure" },
		{
			...result,
			stdout: JSON.stringify({ ...failure, name: "接続の準備" }),
		},
		{
			...result,
			stdout: JSON.stringify({ ...failure, message: "接続待機が失敗" }),
		},
		{
			...result,
			stdout: JSON.stringify({ ...failure, type: "hookFailed" }),
		},
		{
			...result,
			stdout: `${JSON.stringify(failure)}\n${JSON.stringify({ ...failure, code: "MODULE_NOT_FOUND" })}`,
		},
	]) {
		assert.throws(() => verify(invalid, "fixture"), /狙った回帰/);
	}
});
