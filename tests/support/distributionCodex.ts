// 展開 VSIX の固定情報で公式 Codex を取得し、配布検証専用の実行先として渡す。
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readCodexRelease } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/CodexRelease";
import { installCodex } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/downloadCodex";

/** 利用者の CLI を更新せず、一時領域への取得と不要物の除外を実物で検証する。 */
export async function prepareCodex(
	extension: string,
	storage: string,
): Promise<string> {
	const release = await readCodexRelease(extension);
	await assert.rejects(
		access(join(extension, "dist/runtime/node_modules/@openai")),
		{ code: "ENOENT" },
	);
	await assert.rejects(
		access(join(extension, "dist/runtime/pi/bundle-meta.json")),
		{ code: "ENOENT" },
	);
	const pty = join(extension, "dist/runtime/node_modules/node-pty");
	await assert.rejects(access(join(pty, "third_party")), { code: "ENOENT" });
	await assert.rejects(access(join(pty, "build")), { code: "ENOENT" });
	const files = await readdir(join(pty, "prebuilds/win32-x64"));
	assert.equal(
		files.some((name) => name.endsWith(".pdb")),
		false,
	);
	return installCodex(storage, release, AbortSignal.timeout(10 * 60 * 1000));
}
