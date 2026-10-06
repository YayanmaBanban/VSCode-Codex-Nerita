// 開発ツールの検出から MXC 変換まで、秘密情報・書込み上限・拒否記録の承認境界を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, parse } from "node:path";
import { tmpdir } from "node:os";
import {
	discoverDevTools,
	toolResource,
} from "../../apps/vscode-nerita/src/extension/runtime/DevToolDiscovery";
import { initialDevToolProfiles } from "../../apps/vscode-nerita/src/extension/runtime/DevToolProfiles";
import { prepareDevToolStorage } from "../../apps/vscode-nerita/src/extension/runtime/DevToolStorage";
import { readMxcDenials } from "../../apps/vscode-nerita/src/extension/runtime/MxcDenials";
import { sanitizedNpmConfig } from "../../apps/vscode-nerita/src/extension/runtime/DevToolConfig";
import type { DevToolPolicy } from "../../apps/vscode-nerita/src/extension/runtime/DevToolPolicy";

void test("実体 PATH を再構築し API キー・Node 起動フック・相対 PATH を継承しない", async () => {
	const executable = await realpath(process.execPath);
	const policy = await discoverDevTools(
		{
			Path: [".", dirname(executable)].join(delimiter),
			API_TOKEN: "secret",
			NODE_OPTIONS: "--require untrusted",
			SystemRoot: process.env.SystemRoot,
		},
		initialDevToolProfiles,
	);
	assert.equal(policy.executables["node.exe"], executable);
	assert.equal(policy.environment.PATH, dirname(executable));
	assert.equal(policy.environment.API_TOKEN, undefined);
	assert.equal(policy.environment.NODE_OPTIONS, undefined);
	assert.ok(
		!policy.resources.some(
			(resource) => resource.target === parse(executable).root,
		),
	);
});

void test("新しいツールは既存 ResourcePolicy のプロファイルとして追加できる", async () => {
	const executable = await realpath(process.execPath);
	const policy = await discoverDevTools(
		{},
		[
			{
				name: "additional-sdk",
				commands: [executable],
				resolve: (target) => [
					toolResource("helper", target, "additional-sdk", "profile"),
				],
			},
		],
		executable,
	);
	assert.ok(policy.resources.some((resource) => resource.kind === "install"));
	assert.ok(
		policy.resources.some(
			(resource) =>
				resource.kind === "helper" &&
				resource.tool === "additional-sdk",
		),
	);
});

void test("キャッシュは同じ workspace で永続化し、別 workspace とホスト設定から分離する", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-devtools-"));
	try {
		const first = await storageFixture(root, "run-one", "workspace-one");
		const cache = first.resources.find(
			(resource) => resource.kind === "cache",
		)!;
		await writeFile(join(cache.target, "cached.txt"), "retained");
		const second = await storageFixture(root, "run-two", "workspace-one");
		assert.equal(
			await readFile(
				join(second.environment.NPM_CONFIG_CACHE!, "cached.txt"),
				"utf8",
			),
			"retained",
		);
		const third = await storageFixture(root, "run-three", "workspace-two");
		assert.notEqual(
			third.environment.NPM_CONFIG_CACHE,
			first.environment.NPM_CONFIG_CACHE,
		);
		assert.equal(
			await readFile(first.environment.NPM_CONFIG_USERCONFIG!, "utf8"),
			"",
		);
		assert.match(
			await readFile(first.environment.GIT_CONFIG_GLOBAL!, "utf8"),
			/helper =/,
		);
		assert.notEqual(first.environment.USERPROFILE, process.env.USERPROFILE);
		assert.equal(
			first.resources.find((resource) => resource.kind === "credential")!
				.access,
			"deny",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

void test("Sandbox キャッシュがリンクに置換されていたら別領域を許可しない", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-devtools-"));
	try {
		const first = await storageFixture(root, "run-one", "workspace");
		const cache = first.environment.NPM_CONFIG_CACHE!;
		const outside = join(root, "outside");
		await mkdir(outside);
		await rm(cache, { recursive: true });
		await symlink(outside, cache, "junction");
		await assert.rejects(
			storageFixture(root, "run-two", "workspace"),
			/パスが変更/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

void test("拒否レポートは既知リソースだけを分類し、登録だけでは権限を変えない", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-denial-test-"));
	try {
		const resource = toolResource("install", join(root, "sdk"), "sample");
		const policy: DevToolPolicy = {
			resources: [resource],
			environment: {},
			executables: {},
		};
		await writeFile(
			join(root, "denials.123_test.json"),
			JSON.stringify({
				denials: [
					{
						resource: join(root, "sdk", "tool.exe"),
						resourceType: "file",
						accessType: "execute",
					},
					{
						resource: "internetClient",
						resourceType: "capability",
						accessType: "unknown",
					},
				],
				summary: { totalDenials: 2, deniedResourcesTruncated: true },
			}),
		);
		const report = await readMxcDenials(root, policy);
		assert.equal(report.status, "reported");
		assert.equal(report.truncated, true);
		assert.equal(report.events[0]!.resource!.kind, "install");
		assert.equal(report.events[0]!.resource!.access, "deny");
		assert.equal(report.events[1]!.resource, undefined);
		assert.equal(policy.resources[0]!.access, "read");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

void test("npm 設定は認証情報と起動フックを除き、公開 registry 設定だけを残す", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-config-test-"));
	try {
		const source = join(root, ".npmrc");
		await writeFile(
			source,
			"registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=SECRET\n@private:registry=https://user:SECRET@example.test/\n@query:registry=https://example.test/?token=SECRET\nscript-shell=untrusted\nstrict-ssl=false\nfund=false\n",
		);
		assert.equal(
			await sanitizedNpmConfig(source),
			"registry=https://registry.npmjs.org/\nfund=false\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/** テストが作った専用領域だけで永続化を確認する。 */
async function storageFixture(root: string, run: string, workspace: string) {
	const temporary = join(root, run);
	await mkdir(temporary);
	return prepareDevToolStorage(
		{ resources: [], environment: {}, executables: {} },
		join(root, "managed"),
		join(root, workspace),
		temporary,
	);
}
