// CLI が設定パイプを開かず終了する場合も、配布ランチャーが待機を解除して終了コードを返す。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

void test("設定パイプを開かず終了した CLI の終了コードを返し、接続待ちを残さない", async () => {
	assert.ok(isNonEmptyString(process.env.NERITA_TEST_EXTENSION));
	const pending = promisify(execFile)(
		join(
			process.env.SystemRoot!,
			"System32/WindowsPowerShell/v1.0/powershell.exe",
		),
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			join(
				process.env.NERITA_TEST_EXTENSION,
				"dist/runtime/nerita-mxc-launcher.ps1",
			),
			// Node は --config を受け付けず、パイプ接続前に実際のプロセスが終了する。
			"-Executable",
			process.execPath,
		],
		{ windowsHide: true, timeout: 5000 },
	);
	pending.child.stdin!.end("{}");
	await assert.rejects(pending, (error: unknown) => {
		z.object({
			code: z.literal(9),
			killed: z.literal(false),
			stdout: z.literal(""),
			stderr: z.string().regex(/bad option: --config/u),
		}).parse(error);
		return true;
	});
});
