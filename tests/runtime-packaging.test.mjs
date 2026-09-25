// 配布先での ESM 解決・資産参照・依存のバージョン分離を実ファイルで検証する。
import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	writeFile,
	rm,
	readdir,
	lstat,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import packaging from "../config/copy-runtime-package.cjs";

/** 開発ツリーの外に入力・出力を分離し、テスト専用ディレクトリだけを後片付けする。 */
async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "nerita-package-"));
	t.after(async () => {
		assert.equal(path.dirname(root), tmpdir());
		assert.ok(path.basename(root).startsWith("nerita-package-"));
		await rm(root, { recursive: true, force: true });
	});
	return root;
}

/** package.json の exports にはインポート条件のみを設け、内部パスへの依存を検出する。 */
async function makePackage(directory, name, code, metadata = {}) {
	await mkdir(directory, { recursive: true });
	await writeFile(
		path.join(directory, "package.json"),
		JSON.stringify({
			name,
			version: "1.0.0",
			type: "module",
			exports: { ".": { import: "./index.js" } },
			...metadata,
		}),
	);
	await writeFile(path.join(directory, "index.js"), code);
}

/** VSIX が参照先の開発環境を必要としないことを全資産で確認する。 */
async function assertNoLinks(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		assert.equal((await lstat(file)).isSymbolicLink(), false, file);
		if (entry.isDirectory()) {
			await assertNoLinks(file);
		}
	}
}

test("ESMの公開入口・相対資産・依存の複数バージョン・循環参照をリンクなしで同梱する", async (t) => {
	const root = await fixture(t);
	const source = path.join(root, "source");
	const sdk = path.join(source, "node_modules/sdk");
	const target = path.join(root, "配布先 with spaces #");
	await makePackage(
		sdk,
		"sdk",
		'export { default as left } from "left"; export { default as right } from "right";',
		{
			dependencies: { left: "1", right: "1" },
			optionalDependencies: { absent: "1" },
			peerDependencies: { optionalPeer: "1" },
			peerDependenciesMeta: { optionalPeer: { optional: true } },
			devDependencies: { developmentOnly: "1" },
		},
	);
	await makePackage(
		path.join(source, "node_modules/left"),
		"left",
		'import value from "shared"; export default value;',
		{ dependencies: { shared: "1" } },
	);
	const right = path.join(source, "node_modules/right");
	await makePackage(
		right,
		"right",
		'import value from "shared"; import left from "left"; export default [value, left];',
		{ dependencies: { shared: "2", left: "1" } },
	);
	await makePackage(
		path.join(source, "node_modules/shared"),
		"shared",
		'export default "v1";',
		{ dependencies: { left: "1" } },
	);
	const sharedV2 = path.join(source, "store/shared-v2");
	await makePackage(
		sharedV2,
		"shared",
		'import { readFileSync } from "node:fs"; export default readFileSync(new URL("./asset.txt", import.meta.url), "utf8");',
		{ version: "2.0.0" },
	);
	await writeFile(path.join(sharedV2, "asset.txt"), "v2 asset");
	await mkdir(path.join(right, "node_modules"));
	await symlink(
		sharedV2,
		path.join(right, "node_modules/shared"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await packaging.copyRuntimePackage(sdk, target);
	await writeFile(path.join(target, "entry.mjs"), 'export * from "sdk";');
	const result = await import(
		pathToFileURL(path.join(target, "entry.mjs")).href
	);
	assert.equal(result.left, "v1");
	assert.deepEqual(result.right, ["v2 asset", "v1"]);
	assert.equal(
		(await readdir(path.join(target, "node_modules"))).includes(
			"developmentOnly",
		),
		false,
	);
	await assertNoLinks(target);
});

test("必須依存の欠落はコピーを始める前に失敗させる", async (t) => {
	const root = await fixture(t);
	const sdk = path.join(root, "sdk");
	await makePackage(sdk, "sdk", "", {
		dependencies: { "nerita-missing-runtime-dependency": "1" },
	});
	await assert.rejects(
		packaging.copyRuntimePackage(sdk, path.join(root, "output")),
		/nerita-missing-runtime-dependency/,
	);
	await assert.rejects(lstat(path.join(root, "output")), { code: "ENOENT" });
});

test("別OS用のoptional dependencyとその依存は同梱しない", async (t) => {
	const root = await fixture(t);
	const sdk = path.join(root, "sdk");
	const target = path.join(root, "output");
	await makePackage(sdk, "sdk", "", {
		optionalDependencies: { unsupported: "1" },
	});
	await makePackage(
		path.join(sdk, "node_modules/unsupported"),
		"unsupported",
		"",
		{ os: [`!${process.platform}`], dependencies: { unavailable: "1" } },
	);
	await packaging.copyRuntimePackage(sdk, target);
	assert.deepEqual(await readdir(path.join(target, "node_modules")), ["sdk"]);
});
