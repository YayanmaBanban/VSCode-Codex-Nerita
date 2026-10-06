// 永続保存・メモリー消失・アカウント更新を、製品アダプターと同梱 SDK の入口から確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { credentialFixture } from "../support/credentials";
import { piFixture } from "../support/pi";
import { SecretValue } from "../../apps/vscode-nerita/src/extension/credentials/CredentialStore";
import { BindingStore } from "../../apps/vscode-nerita/src/extension/credentials/BindingStore";
import { credentialBindingSchema } from "../../packages/shared/src/credentials";
import { preparePiAuthMigration } from "../../apps/vscode-nerita/src/extension/credentials/PiAuthMigration";
import { SecretAuthBackend } from "../../apps/vscode-nerita/src/extension/credentials/SecretAuthBackend";
import { prepareMcpAuthMigration } from "../../apps/vscode-nerita/src/extension/credentials/McpAuthMigration";
import { CredentialService } from "../../apps/vscode-nerita/src/extension/credentials/CredentialService";

void test("Binding は秘密値と注入先の上書きを拒否し、既存の Git 除外規則を保持する", async (t) => {
	const f = await piFixture(t);
	const binding = {
		id: "packages",
		match: { kind: "npm-registry", target: "npm.pkg.github.com" },
		provider: { type: "npmrc" },
		injection: { type: "npm-auth-token" },
	};
	const store = new BindingStore(f.cwd);
	await store.update(() => [credentialBindingSchema.parse(binding)]);
	const file = join(f.cwd, ".nerita/bindings.json");
	assert.equal(
		await readFile(join(f.cwd, ".nerita/.gitignore"), "utf8"),
		"/bindings.json\n",
	);
	await writeFile(join(f.cwd, ".nerita/.gitignore"), "# preserve\ncache/\n");
	await store.update((items) => items);
	assert.equal(
		await readFile(join(f.cwd, ".nerita/.gitignore"), "utf8"),
		"# preserve\ncache/\n/bindings.json\n",
	);
	const original = await readFile(file, "utf8");
	for (const key of [
		"apiKey",
		"token",
		"password",
		"BWS_ACCESS_TOKEN",
		"value",
	]) {
		const input = {
			...binding,
			provider: { ...binding.provider, [key]: "PRIVATE_MARKER" },
		};
		assert.equal(credentialBindingSchema.safeParse(input).success, false);
		await assert.rejects(store.update(() => [input as never]));
	}
	assert.equal(await readFile(file, "utf8"), original);
	assert.ok(!original.includes("PRIVATE_MARKER"));
	assert.equal(
		credentialBindingSchema.safeParse({
			...binding,
			match: { kind: "api-token", target: "api.example.com" },
			provider: {
				type: "bitwarden-secrets-manager",
				secretId: "2863ced6-eba1-48b4-b5c0-afa30104877a",
			},
			injection: { type: "env", name: "GIT_CONFIG_GLOBAL" },
		}).success,
		false,
	);
	assert.ok(
		!inspect(new SecretValue("PRIVATE_MARKER")).includes("PRIVATE_MARKER"),
	);
});

void test("Host の作り直しでセッション認証だけが消え、永続アカウントは読み戻せる", async () => {
	const f = credentialFixture();
	await loginFixture(f, "secret-storage", "仕事用", "work");
	await loginFixture(f, "session", "個人用", "personal");
	const [work, personal] = f.vault.list("openai");
	assert.equal((await f.credentials.read("openai"))?.type, "oauth");
	assert.ok(!JSON.stringify(f.metadata()).includes("refresh-work"));
	await f.vault.select("openai", work!.id);
	await Promise.all([
		f.credentials.modify("openai", (current) =>
			Promise.resolve({ ...current!, access: "rotated-work" }),
		),
		f.vault.select("openai", personal!.id),
	]);
	assert.equal(accessOf(await f.vault.read(work)), "rotated-work");
	assert.equal(accessOf(await f.credentials.read("openai")), "personal");
	f.stores.dispose();
	const restarted = f.restart();
	assert.deepEqual(
		restarted.vault.list().map((account) => account.name),
		["仕事用"],
	);
	await restarted.vault.select("openai", work!.id);
	assert.equal(
		accessOf(await restarted.credentials.read("openai")),
		"rotated-work",
	);
	await restarted.credentials.delete("openai");
	assert.equal(await restarted.credentials.read("openai"), undefined);
	assert.equal(
		await restarted.credentials.modify("openai", () =>
			Promise.resolve(undefined),
		),
		undefined,
	);
	assert.equal(f.secrets.size, 0);
});

void test("既存 auth.json は読み戻し後の確定まで公開せず、取消しでも元ファイルを保持する", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	const path = join(f.agentDir, "auth.json");
	const imported = oauth("migration");
	const original = JSON.stringify({ openai: imported });
	await writeFile(path, original);
	const staged = await preparePiAuthMigration(
		path,
		storage.vault,
		"secret-storage",
	);
	assert.equal(await storage.credentials.read("openai"), undefined);
	assert.equal(staged.count, 1);
	await staged.cancel();
	assert.equal(storage.secrets.size, 0);
	const next = await preparePiAuthMigration(
		path,
		storage.vault,
		"secret-storage",
	);
	await next.commit();
	await next.cancel();
	assert.equal(await readFile(path, "utf8"), original);
	assert.deepEqual(await storage.credentials.read("openai"), imported);
});

for (const mode of ["session", "secret-storage"] as const) {
	void test(`同梱 SDK が ${mode} の API キーログイン・OAuth の排他更新・ログアウトを使う`, async (t) => {
		const f = await piFixture(t);
		const storage = credentialFixture();
		const sdk = (await import(
			pathToFileURL(
				join(process.env.NERITA_TEST_EXTENSION!, "dist/runtime/pi.mjs"),
			).href
		)) as typeof PiSdk;
		const runtime = await sdk.ModelRuntime.create({
			credentials: storage.credentials,
			modelsPath: null,
			modelsStorePath: join(f.agentDir, "models-store.json"),
			refreshOnCreate: false,
		});
		let refreshes = 0;
		const provider = authProvider(() => {
			refreshes++;
			return Promise.resolve(oauth("rotated"));
		});
		runtime.registerNativeProvider(provider);
		const interaction = {
			prompt: () => Promise.resolve("sdk-api-key"),
			notify: () => {},
		};
		await storage.credentials.login(
			provider.id,
			"api_key",
			mode,
			"API",
			() => runtime.login(provider.id, "api_key", interaction),
		);
		assert.equal(
			(await runtime.getAuth(provider.id))?.auth.apiKey,
			"sdk-api-key",
		);
		await runtime.logout(provider.id);
		assert.equal(await storage.credentials.read(provider.id), undefined);
		await storage.credentials.login(
			provider.id,
			"oauth",
			mode,
			"OAuth",
			() => runtime.login(provider.id, "oauth", interaction),
		);
		await storage.credentials.modify(provider.id, (current) =>
			Promise.resolve({ ...current!, expires: 0 }),
		);
		const resolved = await Promise.all([
			runtime.getAuth(provider.id),
			runtime.getAuth(provider.id),
		]);
		assert.equal(refreshes, 1);
		assert.deepEqual(
			resolved.map((value) => value?.auth.apiKey),
			["rotated", "rotated"],
		);
		assert.equal(
			storage.stores.redactor.text("sdk-api-key rotated refresh-rotated"),
			"[REDACTED] [REDACTED] [REDACTED]",
		);
		await runtime.logout(provider.id);
		assert.equal(await storage.credentials.read(provider.id), undefined);
	});
}

void test("MCP は秘密ストアへ保存完了後に結果を公開し、同じサーバーの refresh を直列化する", async () => {
	const f = credentialFixture();
	const backend = await SecretAuthBackend.create(
		f.stores.persistent,
		f.stores.redactor,
	);
	backend.withLock(() => ({
		result: undefined,
		next: JSON.stringify({
			server: { tokens: { access_token: "mcp-private" } },
		}),
	}));
	await backend.flush();
	assert.equal(f.stores.redactor.text("mcp-private"), "[REDACTED]");
	const restarted = await SecretAuthBackend.create(
		f.restart().stores.persistent,
		f.stores.redactor,
	);
	assert.ok(
		restarted.withLock((current) => ({
			result: current?.includes("mcp-private"),
		})),
	);
	const trace: number[] = [];
	await Promise.all([
		backend.withRefreshLock("server", async () => {
			trace.push(1);
			await Promise.resolve();
			trace.push(2);
		}),
		backend.withRefreshLock("server", () => {
			trace.push(3);
			return Promise.resolve();
		}),
	]);
	assert.deepEqual(trace, [1, 2, 3]);
});

/** 外部認証の応答だけを置き換え、SDK の保存と refresh の実装は本番のものを使う。 */
function authProvider(
	refresh: () => Promise<ReturnType<typeof oauth>>,
): Parameters<PiSdk.ModelRuntime["registerNativeProvider"]>[0] {
	return {
		id: "credential-fixture",
		name: "Fixture",
		getModels: () => [],
		stream: () => {
			throw new Error("No model request");
		},
		streamSimple: () => {
			throw new Error("No model request");
		},
		auth: {
			apiKey: {
				name: "API",
				login: async (interaction) => ({
					type: "api_key",
					key: await interaction.prompt({
						type: "secret",
						message: "API key",
					}),
				}),
				resolve: ({ credential }) =>
					Promise.resolve(
						credential?.key
							? { auth: { apiKey: credential.key } }
							: undefined,
					),
			},
			oauth: {
				name: "OAuth",
				login: () => Promise.resolve(oauth("sdk-oauth")),
				refresh,
				toAuth: (credential) =>
					Promise.resolve({ apiKey: credential.access }),
			},
		},
	};
}
/** 認証値は実アカウントと関係のない試験専用の文字列。 */
function oauth(access: string) {
	return {
		type: "oauth" as const,
		access,
		refresh: `refresh-${access}`,
		expires: Date.now() + 3600000,
	};
}

void test("MCP の明示移行は取消しで新しい保存値を消し、確定後も元ファイルと現行の認証を保持する", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	const backend = await SecretAuthBackend.create(
		storage.stores.persistent,
		storage.stores.redactor,
	);
	const file = join(f.agentDir, "mcp-auth.json");
	const original = JSON.stringify({
		"server|https://mcp.example.test/": {
			tokens: { access_token: "mcp-migration-private" },
		},
	});
	await writeFile(file, original);
	const first = await prepareMcpAuthMigration(
		file,
		storage.stores.persistent,
		backend,
	);
	assert.equal(first.count, 1);
	await first.cancel();
	assert.equal(storage.secrets.size, 0);
	const second = await prepareMcpAuthMigration(
		file,
		storage.stores.persistent,
		backend,
	);
	await second.commit();
	await second.cancel();
	assert.equal(storage.secrets.size, 1);
	assert.equal(await readFile(file, "utf8"), original);
	assert.equal(
		storage.stores.redactor.text("mcp-migration-private"),
		"[REDACTED]",
	);
});
/** 認証方式を確認してから OAuth の試験値を比較する。 */
function accessOf(
	credential: Awaited<
		ReturnType<ReturnType<typeof credentialFixture>["credentials"]["read"]>
	>,
) {
	return credential?.type === "oauth" ? credential.access : undefined;
}
/** 複数アカウントの準備も製品のログイン保存契約を通す。 */
function loginFixture(
	f: ReturnType<typeof credentialFixture>,
	mode: "session" | "secret-storage",
	name: string,
	access: string,
) {
	return f.credentials.login("openai", "oauth", mode, name, () =>
		f.credentials.modify("openai", () => Promise.resolve(oauth(access))),
	);
}

void test("BWS の保存モード変更は直列化され、失敗しても既存の認証を失わない", async () => {
	const f = credentialFixture();
	const metadata = new Map<string, unknown>();
	let fail = false;
	const context = {
		secrets: {
			get: (key: string) => Promise.resolve(f.secrets.get(key)),
			store: (key: string, value: string) => {
				f.secrets.set(key, value);
				return Promise.resolve();
			},
			delete: (key: string) => {
				f.secrets.delete(key);
				return Promise.resolve();
			},
		},
		globalState: {
			get: (key: string, fallback?: unknown) =>
				metadata.get(key) ?? fallback,
			update: (key: string, value: unknown) => {
				if (fail) {
					return Promise.reject(new Error("metadata unavailable"));
				}
				metadata.set(key, structuredClone(value));
				return Promise.resolve();
			},
		},
	} as unknown as ConstructorParameters<typeof CredentialService>[0];
	const service = new CredentialService(context);
	await service.loginBws("work", "secret-storage", "bws-original");
	fail = true;
	await assert.rejects(
		service.loginBws("work", "session", "bws-replacement"),
	);
	assert.equal(service.bwsMode("work"), "secret-storage");
	assert.equal(await service.stores.memory.get("bws.auth.work"), undefined);
	assert.equal(f.secrets.get("bws.auth.work"), "bws-original");
	fail = false;
	await Promise.all([
		service.loginBws("work", "session", "bws-session"),
		service.loginBws("work", "secret-storage", "bws-persistent"),
	]);
	assert.equal(service.bwsMode("work"), "secret-storage");
	assert.deepEqual(service.bwsAccounts(), ["default", "work"]);
	service.dispose();
	const restarted = new CredentialService(context);
	const value = await restarted.bws.get("bws.auth.work");
	assert.equal(
		value?.use((text) => text),
		"bws-persistent",
	);
	value?.dispose();
	assert.equal(
		restarted.stores.redactor.text("bws-persistent"),
		"[REDACTED]",
	);
	await restarted.logoutBws("work");
	assert.equal(f.secrets.has("bws.auth.work"), false);
	restarted.dispose();
});
