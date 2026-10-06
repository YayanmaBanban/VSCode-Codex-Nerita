// 導入済み Web 拡張で公開リポジトリを取得し、保存先と信頼境界を確認する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { join, delimiter, dirname } from "node:path";

import { piFixture, send, permission, finished } from "../support/pi";

void test("導入済み Web 拡張の取得先を未信頼として扱う", verifyPiWebTrust);

/** 取得したコードは未信頼のままとし、明示的な信頼後にだけ変更を許可する。 */
async function verifyPiWebTrust(t: TestContext) {
	const f = await piFixture(t);
	// 新規ホームには `gh` のログイン情報がないため、公開リポジトリの取得には Git を使う。
	preferPublicGit(t);
	const { cache } = await prepareWebExtension(f);
	f.model.replies.push(
		{
			name: "fetch_content",
			arguments: {
				url: "https://github.com/octocat/Hello-World",
				forceClone: true,
			},
		},
		"取得を確認",
	);
	const controller = f.controller();
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		JSON.stringify(controller.snapshot()),
	);
	await send(controller, "公開リポジトリを取得");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.tools[0]?.status, "completed", JSON.stringify(state));
	const files = await readdir(cache, { recursive: true });
	const readme = files.find((file) => file.endsWith("README"));
	assert.ok(isNonEmptyString(readme), JSON.stringify(state.tools));
	const target = join(cache, readme);
	assert.ok((await readFile(target, "utf8")).length > 0);
	assert.equal(await f.trust.trusted(target), false);
	await assert.rejects(f.trust.setUserTrust(cache, true));
	// Web 拡張はセッション終了時に取得物を消すため、取得元のセッションを維持する。
	f.options.trustedExtensionPaths = [];
	const repository = dirname(target);
	f.options.parentPolicy!.workspaceRoots = [f.cwd, repository];
	f.options.parentPolicy!.writableRoots = [f.cwd, repository];
	const editing = f.controller();
	await editing.connect();
	f.model.replies.push(
		{
			name: "write",
			arguments: { path: target, content: "untrusted overwrite" },
		},
		"拒否を確認",
	);
	const original = await readFile(target, "utf8");
	await send(editing, "取得したコードを書き換える");
	const denied = await finished(editing);
	assert.equal(denied.tools.at(-1)?.status, "failed", JSON.stringify(denied));
	assert.equal(await readFile(target, "utf8"), original);
	assert.equal(denied.permissions.length, 0);
	assert.ok(JSON.stringify(denied.tools.at(-1)?.content).includes("未信頼"));
	await editing.dispose();
	await f.trust.setUserTrust(repository, true);
	const allowed = f.controller();
	await allowed.connect();
	f.model.replies.push(
		{
			name: "write",
			arguments: { path: target, content: "trusted update" },
		},
		"許可を確認",
	);
	await send(allowed, "信頼後に変更");
	await permission(allowed, "accept");
	assert.equal((await finished(allowed)).tools.at(-1)?.status, "completed");
	assert.equal(await readFile(target, "utf8"), "trusted update");
}

/** 公開取得だけに Git を使い、PATH はテスト終了時に復元する。 */
function preferPublicGit(t: TestContext) {
	const previousPath = process.env.PATH;
	process.env.PATH = (previousPath ?? "")
		.split(delimiter)
		.filter((directory) => !existsSync(join(directory, "gh.exe")))
		.join(delimiter);
	t.after(() => {
		if (previousPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = previousPath;
		}
	});
}

/** 導入済み拡張を検査し、取得物を一時キャッシュへ固定する。 */
async function prepareWebExtension(f: Awaited<ReturnType<typeof piFixture>>) {
	assert.ok(
		isNonEmptyString(process.env.NERITA_EXTERNAL_AGENT_DIR) &&
			isNonEmptyString(process.env.PI_CODING_AGENT_DIR),
	);
	const installed = join(
		process.env.NERITA_EXTERNAL_AGENT_DIR,
		"npm/node_modules/pi-web-access",
	);
	const manifest = JSON.parse(
		await readFile(join(installed, "package.json"), "utf8"),
	) as { name: string };
	assert.equal(manifest.name, "pi-web-access");
	const cache = join(f.root, "download-cache");
	await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	await writeFile(
		join(process.env.PI_CODING_AGENT_DIR, "web-search.json"),
		JSON.stringify({
			githubClone: { clonePath: cache, cloneTimeoutSeconds: 30 },
		}),
	);
	await f.trust.setUserTrust(installed, true);
	f.options.trustedExtensionPaths = [
		await realpath(join(installed, "dist/index.js")),
	];
	f.options.parentPolicy = {
		workspaceRoots: [f.cwd],
		writableRoots: [f.cwd],
		networkAccess: true,
		shell: false,
	};
	return { cache };
}
