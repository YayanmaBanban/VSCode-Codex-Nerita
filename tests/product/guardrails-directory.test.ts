// 照合方式ごとの保存値と、フォルダ選択結果のワークスペース境界を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import {
	evaluateGuardrails,
	guardrailWarnings,
} from "../../apps/vscode-nerita/src/extension/security/GuardrailEvaluator";
import { selectedDirectory } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/selectedDirectory";

void test("ディレクトリ配下は保存したGlobを使用せず、対象フォルダと例外だけを判定する", async () => {
	const root = process.cwd();
	const config = defaultGuardrails();
	config.pathRules = [
		{
			id: "private",
			action: "deny",
			reason: "個別の保護",
			match: "directory",
			pattern: "**/*.txt",
			directory: "private",
			exceptions: ["private/public/**"],
			operations: ["read"],
		},
	];
	const saved = parseGuardrails(JSON.stringify(config));
	assert.deepEqual(saved, config);
	for (const [input, action] of [
		["private/data.bin", "deny"],
		["private/public/readme.txt", "allow"],
		["private-other/data.bin", "allow"],
		["notes.txt", "allow"],
	] as const) {
		const actual = await evaluateGuardrails(saved, root, [root], {
			tool: "read",
			input,
			cwd: ".",
		});
		assert.equal(actual.action, action, input);
	}
	saved.pathRules[0]!.match = "glob";
	assert.equal(
		(
			await evaluateGuardrails(saved, root, [root], {
				tool: "read",
				input: "notes.txt",
				cwd: ".",
			})
		).action,
		"deny",
	);
	assert.equal(saved.pathRules[0]!.directory, "private");
	for (const directory of [
		"../outside",
		"/absolute",
		"C:/private",
		"private/**",
		"private/?",
	]) {
		assert.throws(() =>
			parseGuardrails(
				JSON.stringify({
					...config,
					pathRules: [{ ...config.pathRules[0], directory }],
				}),
			),
		);
	}
});

void test("競合の警告は有効な照合方式の値で比較する", () => {
	const config = defaultGuardrails();
	const rule = {
		id: "first",
		action: "deny",
		reason: "保護",
		match: "directory",
		pattern: "*.txt",
		directory: "private",
		exceptions: [],
		operations: ["read"],
	} as const;
	config.pathRules = [
		{ ...rule, exceptions: [], operations: ["read"] },
		{
			...rule,
			id: "second",
			action: "ask",
			pattern: "*.log",
			exceptions: [],
			operations: ["read"],
		},
	];
	assert.equal(guardrailWarnings(config).length, 1);
	config.pathRules[1]!.directory = "other";
	assert.equal(guardrailWarnings(config).length, 0);
});

void test("フォルダだけをワークスペース相対で受け付け、外部・外部リンク・ファイルを拒否する", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nerita-directory-"));
	try {
		const root = join(temporary, "workspace");
		const child = join(root, "nested", "日本語 folder");
		const outside = join(temporary, "workspace-other");
		await mkdir(child, { recursive: true });
		await mkdir(outside);
		await writeFile(join(root, "file.txt"), "example");
		await symlink(outside, join(root, "linked"), "junction");
		assert.equal(
			await selectedDirectory(root, child),
			"nested/日本語 folder",
		);
		assert.equal(await selectedDirectory(root, root), ".");
		await assert.rejects(selectedDirectory(root, outside));
		await assert.rejects(selectedDirectory(root, join(root, "linked")));
		await assert.rejects(selectedDirectory(root, join(root, "file.txt")));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
