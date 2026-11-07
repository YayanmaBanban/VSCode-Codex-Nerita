// 導入済み Web 拡張で UA の補完・明示値の保持と、設定変更や取得先の信頼境界を確認する。
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	readdir,
	realpath,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join, delimiter, dirname } from "node:path";
import { piFixture, send, permission, finished, until } from "../support/pi";

for (const decision of ["accept", "decline"]) {
	void test(`Web 拡張の URL の個人情報を ${decision} するまで送信しない`, async (t) => {
		const f = await piFixture(t);
		await prepareWebExtension(f);
		const server = await webServer(t);
		const email = "person@example.invalid";
		const path = `/page?contact=${encodeURIComponent(email)}`;
		f.model.replies.push(
			{
				name: "fetch_content",
				arguments: { url: `${server.url}${path}`, mode: "raw" },
			},
			"確認完了",
		);
		const controller = f.controller();
		await controller.connect();
		await send(controller, "ページを取得");
		await permission(controller, "accept");
		await until(() => {
			const state = controller.snapshot();
			return state.permissions.length > 0 || state.run !== "running";
		});
		assert.deepEqual(
			server.requests,
			[],
			"個人情報の許可前に Web 拡張を実行しない",
		);
		assert.ok(
			!JSON.stringify(controller.snapshot().permissions).includes(email),
		);
		await permission(controller, decision);
		const state = await finished(controller);
		assert.equal(
			state.tools[0]?.status,
			decision === "accept" ? "completed" : "failed",
		);
		assert.equal(server.requests.length, decision === "accept" ? 1 : 0);
	});
}

void test("導入済み Web 拡張の取得先を未信頼として扱う", verifyPiWebTrust);

void test("個人情報の追加承認中に Web 設定を変更すると送信しない", async (t) => {
	const f = await piFixture(t);
	const { config, configPath } = await prepareWebExtension(f);
	const server = await webServer(t);
	f.model.replies.push(
		{
			name: "fetch_content",
			arguments: {
				url: `${server.url}/page?contact=person%40example.invalid`,
				mode: "raw",
			},
		},
		"変更を確認",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "ページを取得");
	await permission(controller, "accept");
	await until(() => {
		const state = controller.snapshot();
		return state.permissions.length > 0 || state.run !== "running";
	});
	assert.equal(
		server.requests.length,
		0,
		"追加承認の検査を待つ間は送信しない",
	);
	await writeFile(
		configPath,
		JSON.stringify({
			...config,
			fetchContent: { userAgent: "ChangedClient/3.0" },
		}),
	);
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(
		state.tools[0]?.status,
		"failed",
		"追加承認中の出所変更では古い許可を再利用しない",
	);
	assert.deepEqual(server.requests, []);
});

void test("グローバルの Web 設定がない場合は固定 User-Agent の設定を自動生成する", async (t) => {
	const f = await piFixture(t);
	const { configPath } = await prepareWebExtension(f);
	await unlink(configPath);
	const controller = f.controller();
	await controller.connect();

	assert.equal(controller.snapshot().connection, "ready");
	assert.equal(
		existsSync(configPath),
		true,
		"Web 設定がなければグローバルに自動生成する",
	);
	assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
		fetchContent: { userAgent: "Nerita/1.0" },
	});
	await assert.rejects(readFile(join(f.cwd, ".pi/web-search.json")), {
		code: "ENOENT",
	});
});

void test("導入済み Web 拡張がリダイレクト先にも固定 User-Agent を送る", async (t) => {
	const f = await piFixture(t);
	await prepareWebExtension(f);
	const server = await webServer(t);
	f.model.replies.push(
		{
			name: "fetch_content",
			arguments: { url: `${server.url}/redirect`, mode: "raw" },
		},
		"取得を確認",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "ページを取得");
	await permission(controller, "accept");
	const state = await finished(controller);

	assert.equal(state.tools[0]?.status, "completed", JSON.stringify(state));
	assert.deepEqual(server.requests, [
		{ path: "/redirect", userAgent: "Nerita/1.0" },
		{ path: "/page", userAgent: "Nerita/1.0" },
	]);
});

for (const [label, fetchContent] of [
	["`fetchContent` 未指定", undefined],
	["UA 未指定", { redirects: "same-origin" }],
] as const) {
	void test(`既存設定の${label}なら既定 UA を補って送信する`, async (t) => {
		const f = await piFixture(t);
		const { config, configPath } = await prepareWebExtension(f);
		await writeFile(
			configPath,
			JSON.stringify({ ...config, fetchContent }),
		);
		const server = await webServer(t);
		f.model.replies.push(
			{
				name: "fetch_content",
				arguments: { url: `${server.url}/page`, mode: "raw" },
			},
			"取得を確認",
		);
		const controller = f.controller();
		await controller.connect();
		assert.equal(controller.snapshot().connection, "ready");
		assert.deepEqual(
			JSON.parse(await readFile(configPath, "utf8")),
			{
				...config,
				fetchContent: { ...fetchContent, userAgent: "Nerita/1.0" },
			},
			"未指定の UA だけを補って既存設定を保持する",
		);
		await send(controller, "ページを取得");
		await permission(controller, "accept");
		const state = await finished(controller);

		assert.equal(
			state.tools[0]?.status,
			"completed",
			JSON.stringify(state),
		);
		assert.deepEqual(server.requests, [
			{ path: "/page", userAgent: "Nerita/1.0" },
		]);
	});
}

void test("明示された User-Agent は設定ファイルを変更せずそのまま送信する", async (t) => {
	const f = await piFixture(t);
	const { config, configPath } = await prepareWebExtension(f);
	const userAgent = "ResearchClient/2.0 (contact: user@example.invalid)";
	const originalConfig = JSON.stringify({
		...config,
		fetchContent: { userAgent },
	});
	await writeFile(configPath, originalConfig);
	const server = await webServer(t);
	f.model.replies.push(
		{
			name: "fetch_content",
			arguments: { url: `${server.url}/page`, mode: "raw" },
		},
		"取得を確認",
	);
	const controller = f.controller();
	await controller.connect();
	assert.equal(controller.snapshot().connection, "ready");
	assert.equal(await readFile(configPath, "utf8"), originalConfig);
	await send(controller, "ページを取得");
	await until(
		() =>
			controller.snapshot().permissions.length > 0 ||
			controller.snapshot().tools[0]?.status === "failed",
	);
	assert.equal(
		controller.snapshot().permissions.length,
		1,
		"明示された UA で取得を承認できる",
	);
	await permission(controller, "accept");
	const state = await finished(controller);

	assert.equal(state.tools[0]?.status, "completed", JSON.stringify(state));
	assert.deepEqual(server.requests, [{ path: "/page", userAgent }]);
});

void test("Web 取得の承認待ち中に User-Agent を変更すると承認後も送信しない", async (t) => {
	const f = await piFixture(t);
	const { config, configPath } = await prepareWebExtension(f);
	const server = await webServer(t);
	f.model.replies.push(
		{
			name: "fetch_content",
			arguments: { url: `${server.url}/page`, mode: "raw" },
		},
		"拒否を確認",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "ページを取得");
	await until(() => controller.snapshot().permissions.length > 0);
	await writeFile(
		configPath,
		JSON.stringify({
			...config,
			fetchContent: { userAgent: "Nerita (user@example.invalid)" },
		}),
	);
	await permission(controller, "accept");
	const state = await finished(controller);

	assert.equal(state.tools[0]?.status, "failed", JSON.stringify(state));
	assert.deepEqual(server.requests, []);
});

/** 実際に到着したヘッダーを記録し、同じホストへのリダイレクトも検証する。 */
async function webServer(t: TestContext) {
	const requests: {
		path: string | undefined;
		userAgent: string | undefined;
	}[] = [];
	const server = createServer((request, response) => {
		requests.push({
			path: request.url,
			userAgent: request.headers["user-agent"],
		});
		if (request.url === "/redirect") {
			response.writeHead(302, { Location: "/page" });
			response.end();
			return;
		}
		response.writeHead(200, { "Content-Type": "text/plain" });
		response.end("public test page");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(async () => {
		const closed = once(server, "close");
		server.closeAllConnections();
		server.close();
		await closed;
	});
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
	return { url: `http://127.0.0.1:${address.port}`, requests };
}

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
	const manifest = z
		.looseObject({ name: z.string() })
		.parse(
			JSON.parse(await readFile(join(installed, "package.json"), "utf8")),
		);
	assert.equal(manifest.name, "pi-web-access");
	const cache = join(f.root, "download-cache");
	await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	const configPath = join(process.env.PI_CODING_AGENT_DIR, "web-search.json");
	const config = {
		githubClone: { clonePath: cache, cloneTimeoutSeconds: 30 },
		fetchContent: { userAgent: "Nerita/1.0" },
		ssrf: { allowRanges: ["127.0.0.0/8"] },
	};
	await writeFile(configPath, JSON.stringify(config));
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
	return { cache, configPath, config };
}
