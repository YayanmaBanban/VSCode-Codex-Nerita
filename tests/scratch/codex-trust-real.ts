// 同梱 App Server の設定 API を一時的な `CODEX_HOME` で検証する。esbuild で CJS 化して実行する。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexWorkspaceTrust } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/CodexWorkspaceTrust";
import { execFileSync } from "node:child_process";
import { CodexClient } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";
import { trustKey } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";

async function main() {
	const root = await mkdtemp(join(tmpdir(), "nerita-codex-trust-"));
	const home = join(root, "home");
	const workspace = join(root, "project.with.dots");
	await mkdir(home);
	await mkdir(workspace);
	execFileSync("git", ["init", workspace], {
		windowsHide: true,
		stdio: "ignore",
	});
	execFileSync(
		"git",
		[
			"-C",
			workspace,
			"-c",
			"user.name=Trust Test",
			"-c",
			"user.email=trust@example.test",
			"commit",
			"--allow-empty",
			"-m",
			"initial",
		],
		{ windowsHide: true, stdio: "ignore" },
	);
	const worktree = join(root, "worktree");
	execFileSync(
		"git",
		["-C", workspace, "worktree", "add", "--detach", worktree],
		{ windowsHide: true, stdio: "ignore" },
	);
	await writeFile(join(home, "config.toml"), "model = 'gpt-5'\n");
	process.env.CODEX_HOME = home;
	const extensionPath = resolve("apps/vscode-nerita");
	const trust = new CodexWorkspaceTrust(extensionPath, () => {});
	await trust.registerWorkspace(workspace);
	await verifyAliases(trust, extensionPath, workspace);
	await verifyMultiple(trust, root, workspace);
	assert.equal(await trust.trusted(workspace), false);
	await trust.change(workspace, "trusted");
	assert.equal(await trust.trusted(workspace), true);
	assert.equal(await trust.trusted(worktree), true);
	await trust.change(worktree, "untrusted");
	assert.equal(await trust.trusted(worktree), false);
	assert.equal(await trust.trusted(workspace), true);
	await trust.change(worktree, "unset");
	// `trust_level` を解除してもプロジェクトのテーブルは残るため、Codex はその未設定のテーブルを採用する。
	assert.equal(await trust.trusted(worktree), false);
	assert.equal(
		(await new CodexWorkspaceTrust(extensionPath, () => {}).list()).find(
			(record) => record.root.toLowerCase() === workspace.toLowerCase(),
		)?.trust,
		"trusted",
	);
	await trust.change(workspace, "untrusted");
	assert.equal(await trust.trusted(workspace), false);
	assert.equal(
		(await trust.list()).find(
			(record) => record.root.toLowerCase() === workspace.toLowerCase(),
		)?.trust,
		"untrusted",
	);
	await trust.change(workspace, "unset");
	assert.equal(await trust.trusted(workspace), false);
	const saved = await readFile(join(home, "config.toml"), "utf8");
	assert.ok(saved.includes("gpt-5"));
	assert.ok(!saved.includes("trust_level"));
	console.log("Actual Codex config/read + config/batchWrite: passed");
}

/** CLI と Nerita の表記違いによる矛盾を再現し、片方を隠さず小文字へ集約する。 */
async function verifyAliases(
	trust: CodexWorkspaceTrust,
	extensionPath: string,
	workspace: string,
) {
	const lower = trustKey(workspace);
	const upper = workspace.toUpperCase();
	const client = await CodexClient.connect({
		extensionPath,
		cwd: extensionPath,
		clientInfo: {
			name: "nerita_trust_test",
			title: "Trust test",
			version: "0.0.1",
		},
	});
	try {
		await client.writeProjectTrust(lower, "untrusted");
		await client.writeProjectTrust(upper, "trusted");
	} finally {
		await client.dispose();
	}
	const conflicting = await trust.list();
	assert.equal(
		conflicting.find((record) => record.root === lower)?.trust,
		"untrusted",
	);
	assert.equal(
		conflicting.find((record) => record.root === upper)?.trust,
		"trusted",
	);
	assert.equal(await trust.trusted(workspace), false);
	await trust.change(upper, "trusted");
	const normalized = await trust.list();
	assert.deepEqual(
		normalized.map((record) => ({
			root: record.root,
			trust: record.trust,
		})),
		[{ root: lower, trust: "trusted" }],
	);
	assert.equal(await trust.trusted(workspace), true);
	await trust.change(workspace, "unset");
}

/** 別項目の変更と並行する一覧取得で、保存済みの信頼を巻き戻さない。 */
async function verifyMultiple(
	trust: CodexWorkspaceTrust,
	root: string,
	workspace: string,
) {
	const second = join(root, "second-project");
	await mkdir(second);
	await trust.registerWorkspace(second);
	for (let index = 0; index < 4; index++) {
		await trust.change(workspace, "trusted");
		await Promise.all([
			trust.list(),
			trust.trusted(workspace),
			trust.trusted(second),
		]);
		await trust.change(second, "trusted");
		const records = await trust.list();
		assert.equal(
			records.find((record) => record.root === trustKey(workspace))
				?.trust,
			"trusted",
		);
		assert.equal(
			records.find((record) => record.root === trustKey(second))?.trust,
			"trusted",
		);
		await trust.change(second, "untrusted");
		assert.equal(await trust.trusted(workspace), true);
	}
	await trust.change(workspace, "unset");
	await trust.change(second, "unset");
}
main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
