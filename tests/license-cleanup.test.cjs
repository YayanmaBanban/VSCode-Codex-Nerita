// ライセンス整理で現在版・他製品・リンク先を保持し、欠落時に削除しないことを検証する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { test } = require("node:test");
const { cleanupLicenses } = require("../config/cleanup-licenses.cjs");

/** 実ファイルと外部参照をテスト専用ディレクトリ内に配置する。 */
async function fixture(context) {
	const temporary = await fs.mkdtemp(
		path.join(tmpdir(), "nerita-license-test-"),
	);
	context.after(async () => {
		assert.equal(path.dirname(temporary), tmpdir());
		assert.ok(path.basename(temporary).startsWith("nerita-license-test-"));
		assert.equal(await fs.realpath(temporary), temporary);
		await fs.rm(temporary, { recursive: true });
	});
	const root = path.join(temporary, "licenses");
	for (const name of [
		"codex-1.0.0",
		"codex-2.0.0",
		"pi-1.0.0",
		"pi-2.0.0",
		"library@1.0.0",
		"codex-notes",
	]) {
		await fs.mkdir(path.join(root, name), { recursive: true });
		await fs.writeFile(path.join(root, name, "LICENSE"), "license");
	}
	await fs.writeFile(path.join(root, "codex-2.0.0/NOTICE"), "notice");
	return { root, temporary };
}

for (const product of ["codex", "pi"]) {
	test(`${product}の旧版だけを削除し、他製品とリンク先を保持する`, async (context) => {
		const { root, temporary } = await fixture(context);
		const external = path.join(temporary, "external");
		await fs.mkdir(external);
		await fs.writeFile(path.join(external, "LICENSE"), "external");
		await fs.symlink(
			external,
			path.join(root, `${product}-0.0.1`),
			process.platform === "win32" ? "junction" : "dir",
		);
		await cleanupLicenses(root, product, "2.0.0");
		await assert.rejects(fs.access(path.join(root, `${product}-1.0.0`)), {
			code: "ENOENT",
		});
		for (const name of [
			`${product}-2.0.0`,
			product === "codex" ? "pi-1.0.0" : "codex-1.0.0",
			"library@1.0.0",
			"codex-notes",
		]) {
			await fs.access(path.join(root, name, "LICENSE"));
		}
		assert.equal(
			await fs.readFile(path.join(external, "LICENSE"), "utf8"),
			"external",
		);
		assert.equal(
			(
				await fs.lstat(path.join(root, `${product}-0.0.1`))
			).isSymbolicLink(),
			true,
		);
	});
}

test("現在版のNOTICEが欠落した場合は旧版を削除しない", async (context) => {
	const { root } = await fixture(context);
	await fs.unlink(path.join(root, "codex-2.0.0/NOTICE"));
	await assert.rejects(cleanupLicenses(root, "codex", "2.0.0"));
	await fs.access(path.join(root, "codex-1.0.0/LICENSE"));
});
