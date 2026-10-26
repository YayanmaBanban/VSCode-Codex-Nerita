// 組み込み保護の切り替えと、追加ルールでは解除できない境界を製品の判定処理で検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import type { GuardResult } from "@nerita/shared/guardrails/messages";
import { inspectGuardPath } from "../../apps/vscode-nerita/src/extension/security/GuardrailPaths";
import { inspectBuiltinCommands } from "../../apps/vscode-nerita/src/extension/security/GuardrailBuiltinCommands";

/** 他の判定結果が混ざらない初期状態を作る。 */
function result(): GuardResult {
	return {
		action: "allow",
		paths: [],
		rules: [],
		reasons: [],
		uncertainties: [],
	};
}

void test("リンク先の機密ディレクトリも組み込みで保護する", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-builtins-"));
	try {
		await mkdir(join(root, ".ssh"));
		await symlink(join(root, ".ssh"), join(root, "ordinary"), "junction");
		const actual = result();
		await inspectGuardPath(
			defaultGuardrails(),
			root,
			[root],
			root,
			"ordinary/config",
			"read",
			actual,
		);
		assert.equal(actual.action, "deny");
		assert.ok(actual.rules.includes("builtin:path:ssh"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

void test("機密ファイルは拒否から承認へ変更でき、追加の許可では解除できない", async () => {
	const config = defaultGuardrails();
	const root = join(process.cwd(), "guardrails-workspace");
	config.pathRules.push({
		id: "allow-all",
		pattern: "**",
		match: "glob",
		action: "allow",
		operations: ["read", "write"],
		exceptions: [],
		reason: "共有ルール",
	});
	const denied = result();
	await inspectGuardPath(
		config,
		root,
		[root],
		root,
		".ssh/id_rsa",
		"read",
		denied,
	);
	assert.equal(denied.action, "deny");
	config.builtins.paths.ssh = "ask";
	const asked = result();
	await inspectGuardPath(
		config,
		root,
		[root],
		root,
		".ssh/id_rsa",
		"read",
		asked,
	);
	assert.equal(asked.action, "ask");
	assert.ok(asked.rules.includes("builtin:path:ssh"));
});

void test("環境変数のサンプルは除外し、通常ファイルと区別する", async () => {
	const config = defaultGuardrails();
	const root = process.cwd();
	for (const [path, action] of [
		[".env", "deny"],
		["nested/.env.local", "deny"],
		[".env.example", "allow"],
		[".env.sample", "allow"],
		["source.ts", "allow"],
		["cert.pem", "ask"],
		[".config/gcloud", "ask"],
	]) {
		const actual = result();
		assert.ok(path !== undefined);
		await inspectGuardPath(
			config,
			root,
			[root],
			root,
			path,
			"read",
			actual,
		);
		assert.equal(actual.action, action, path);
	}
});

void test("外部書き込みと設定自身の書き換えは承認へ緩和できない", async () => {
	const config = defaultGuardrails();
	const root = join(process.cwd(), "guardrails-workspace");
	for (const path of ["../outside.txt", ".pi/guardrails.json"]) {
		const actual = result();
		await inspectGuardPath(
			config,
			root,
			[root],
			root,
			path,
			"write",
			actual,
		);
		assert.equal(actual.action, "deny");
	}
});

void test("危険コマンドのカテゴリ別設定が実際の判定へ反映される", () => {
	const config = defaultGuardrails();
	const commands = {
		git: "git push --force",
		filesystem: "Remove-Item file",
		containers: "docker compose down -v",
		packages: "pnpm remove lib",
		system: "sudo reboot",
		database: "DROP TABLE users",
		secrets: "cat .env",
	} as const;
	for (const [id, command] of Object.entries(commands)) {
		const asked = result();
		inspectBuiltinCommands(config, command, asked);
		assert.equal(asked.action, "ask", command);
		assert.ok(asked.rules.includes(`builtin:command:${id}`));
	}
	config.builtins.commands.git = "deny";
	const denied = result();
	inspectBuiltinCommands(config, "git push --force", denied);
	assert.equal(denied.action, "deny");
	const safe = result();
	inspectBuiltinCommands(config, "git status", safe);
	assert.equal(safe.action, "allow");
});

void test("組み込みの許可と旧基準・旧完全一致形式をJSON境界で拒否する", () => {
	const config = defaultGuardrails();
	assert.deepEqual(parseGuardrails(JSON.stringify(config)), config);
	assert.throws(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				builtins: {
					...config.builtins,
					paths: { ...config.builtins.paths, ssh: "allow" },
				},
			}),
		),
	);
	const rule = {
		id: "file",
		pattern: "safe.txt",
		operations: ["read"],
		action: "deny",
		reason: "個別ファイルの保護",
		exceptions: [],
	};
	assert.doesNotThrow(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				pathRules: [{ ...rule, match: "glob" }],
			}),
		),
	);
	assert.throws(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				pathRules: [{ ...rule, match: "file" }],
			}),
		),
	);
	assert.throws(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				pathRules: [{ ...rule, match: "glob", base: "home" }],
			}),
		),
	);
});
