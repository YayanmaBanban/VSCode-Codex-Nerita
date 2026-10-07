// 永続保存・メモリー消失・アカウント更新を、製品アダプターと同梱 SDK の入口から確認する。
import { loadPiSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSdk";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { credentialFixture } from "../support/credentials";
import { piFixture } from "../support/pi";
import {
	SecretValue,
	SecretRedactor,
} from "../../apps/vscode-nerita/src/extension/credentials/CredentialStore";
import { BindingStore } from "../../apps/vscode-nerita/src/extension/credentials/BindingStore";
import { credentialBindingSchema } from "../../packages/shared/src/credentials";
import { preparePiAuthMigration } from "../../apps/vscode-nerita/src/extension/credentials/PiAuthMigration";
import { SecretAuthBackend } from "../../apps/vscode-nerita/src/extension/credentials/SecretAuthBackend";
import { prepareMcpAuthMigration } from "../../apps/vscode-nerita/src/extension/credentials/McpAuthMigration";
import { CredentialService } from "../../apps/vscode-nerita/src/extension/credentials/CredentialService";
import { PiAccountAuthFlow } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccountAuthFlow";

void test("任意の伏字データは JSON 値として返し、元の Date や構造を保持する型契約を持たない", () => {
	const redactor = new SecretRedactor();
	redactor.protect("fixture-secret");
	const original = {
		createdAt: new Date("2026-01-01T00:00:00Z"),
		nested: { text: "fixture-secret", count: 42 },
	};
	assert.deepEqual(redactor.value(original), {
		createdAt: "2026-01-01T00:00:00.000Z",
		nested: { text: "[REDACTED]", count: 42 },
	});
	assert.equal(original.nested.text, "fixture-secret");
	assert.ok(original.createdAt instanceof Date);
});

void test("認証フローは秘密入力を通知前に保護し、成功後にカタログとモデルの再同期を依頼する", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const models = await sdk.ModelRuntime.create({
		credentials: storage.credentials,
		modelsPath: null,
		modelsStorePath: join(f.agentDir, "models-store.json"),
		refreshOnCreate: false,
	});
	const provider = authProvider(() => Promise.resolve(oauth("unused")));
	models.registerNativeProvider(provider);
	const events: Parameters<
		Parameters<typeof models.login>[2]["notify"]
	>[0][] = [];
	const changed: (string | undefined)[] = [];
	let invalidated = false;
	const flow = new PiAccountAuthFlow(
		models,
		{
			manage: async (items, execute, signal) => {
				assert.ok(
					(await items()).some((item) => item.id === provider.id),
				);
				await execute(JSON.stringify([provider.id, "api_key"]), signal);
			},
			interaction: () => ({
				prompt: (prompt) => {
					if (prompt.type === "select") {
						return Promise.resolve("session");
					}
					return Promise.resolve(
						prompt.type === "secret" ? "progress" : "Fixture",
					);
				},
				notify: (event) => events.push(event),
			}),
		},
		undefined,
		storage.credentials,
		() => {
			invalidated = true;
		},
		(id) => {
			changed.push(id);
			return Promise.resolve();
		},
	);

	await flow.authenticate(new AbortController().signal);
	assert.equal(invalidated, true);
	assert.deepEqual(changed, [provider.id, undefined]);
	assert.deepEqual(events, [
		{ type: "progress", message: "key [REDACTED]" },
		{
			type: "info",
			message: "認証通知に秘密値が含まれるため非公開にしました。",
		},
	]);
	assert.equal((await models.getAuth(provider.id))?.auth.apiKey, "progress");
	assert.equal(storage.vault.list(provider.id)[0]?.name, "Fixture");
	assert.equal(storage.vault.list(provider.id)[0]?.mode, "session");
});

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
		// 型の契約を意図的に破り、実行時検証でも保存を拒否することを確認する。
		// @ts-expect-error 不正な Provider を入力する拒否テスト。
		await assert.rejects(store.update(() => [input]));
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
		const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
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
		})) === true,
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
				login: async (interaction) => {
					const key = await interaction.prompt({
						type: "secret",
						message: "API key",
					});
					interaction.notify({
						type: "progress",
						message: `key ${key}`,
					});
					interaction.notify({
						type: "auth_url",
						url: `https://example.test/${key}`,
					});
					return { type: "api_key", key };
				},
				resolve: ({ credential }) =>
					Promise.resolve(
						isNonEmptyString(credential?.key)
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
	// VS Code 境界で使う秘密ストアとメタデータ操作だけを代替する。
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
	value.dispose();
	assert.equal(
		restarted.stores.redactor.text("bws-persistent"),
		"[REDACTED]",
	);
	await restarted.logoutBws("work");
	assert.equal(f.secrets.has("bws.auth.work"), false);
	restarted.dispose();
});
