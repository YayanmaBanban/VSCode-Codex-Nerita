// HTTP エラーと認証更新の外部境界だけを置き換え、SDK の公開・履歴保存まで確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { credentialFixture } from "../support/credentials";
import { piFixture, send, finished, sessionFiles } from "../support/pi";

const apiKey = "fixture-api-private-key";
const access = "fixture-oauth-private-access";
const refresh = "fixture-oauth-private-refresh";
const errorText = `認証エラー: ${apiKey} ${access} ${refresh}`;

for (const mode of ["session", "secret-storage"] as const) {
	for (const kind of ["api_key", "oauth"] as const) {
		void test(`モデルの HTTP エラーは UI 通知・SDK 状態・JSONL で秘密値を保護する（${mode}/${kind}）`, async (t) => {
			const f = await piFixture(t);
			const storage = credentialFixture();
			f.options.credentials = storage.credentials;
			await configureProvider(f);
			await saveCredentials(storage, mode, kind);
			f.model.replies.push({
				error: { status: 400, message: errorText },
			});
			let context = () => "";
			const controller = f.controller((session) => {
				context = () =>
					JSON.stringify(
						session.contextSource?.buildSessionContext(),
					);
			});
			const notifications: string[] = [];
			controller.subscribe((event) =>
				notifications.push(JSON.stringify(event)),
			);
			await controller.connect();
			assert.equal(controller.snapshot().connection, "ready");
			await send(controller, "HTTP の認証エラーを確認");
			const state = await finished(controller);
			assert.equal(state.run, "failed");
			assert.match(state.error!, /認証エラー.*\[REDACTED\]/);
			assert.deepEqual(f.model.authorizations, [
				`Bearer ${kind === "api_key" ? apiKey : access}`,
			]);
			const saved = await sessionFiles(f.cwd);
			assert.equal(saved.length, 1);
			assert.match(saved[0]!.text, /errorMessage.*\[REDACTED\]/);
			for (const output of [
				JSON.stringify(state),
				...notifications,
				context(),
				...saved.map((file) => file.text),
			]) {
				assertSafe(output);
			}
		});
	}

	void test(`OAuth 更新の例外はモデルエラーとして UI と JSONL で秘密値を保護する（${mode}）`, async (t) => {
		const f = await piFixture(t);
		const storage = credentialFixture();
		f.options.credentials = storage.credentials;
		await configureProvider(f);
		await saveCredentials(storage, mode, "oauth");
		const controller = f.controller();
		const notifications: string[] = [];
		controller.subscribe((event) =>
			notifications.push(JSON.stringify(event)),
		);
		await controller.connect();
		await storage.credentials.modify("local", (current) =>
			Promise.resolve({ ...current!, expires: 0 }),
		);
		await send(controller, "認証更新の例外を確認");
		const state = await finished(controller);
		assert.equal(state.run, "failed");
		assert.match(state.error!, /認証エラー.*\[REDACTED\]/);
		const saved = await sessionFiles(f.cwd);
		assert.equal(saved.length, 1);
		assert.match(saved[0]!.text, /errorMessage.*\[REDACTED\]/);
		for (const output of [
			JSON.stringify(state),
			...notifications,
			saved[0]!.text,
		]) {
			assertSafe(output);
		}
	});
}

/** 試験用キーとトークンも製品のログイン・保存契約を通し、伏字辞書を直接操作しない。 */
async function saveCredentials(
	storage: ReturnType<typeof credentialFixture>,
	mode: "session" | "secret-storage",
	kind: "api_key" | "oauth",
) {
	for (const type of ["api_key", "oauth"] as const) {
		const provider = type === kind ? "local" : "unused-provider";
		await storage.credentials.login(provider, type, mode, type, () =>
			storage.credentials.modify(provider, () =>
				Promise.resolve(
					type === "api_key"
						? { type, key: apiKey }
						: {
								type,
								access,
								refresh,
								expires: Date.now() + 3600000,
							},
				),
			),
		);
	}
}

/** ローカル HTTP と OAuth 応答のみを登録し、確定メッセージを変更する拡張の後でも保護する。 */
async function configureProvider(f: Awaited<ReturnType<typeof piFixture>>) {
	const modelsPath = join(f.agentDir, "models.json");
	const config = JSON.parse(await readFile(modelsPath, "utf8")) as {
		providers: { local: Record<string, unknown> };
	};
	delete config.providers.local.apiKey;
	config.providers.local = {
		...config.providers.local,
		apiKey: "$UNCONFIGURED_FIXTURE_KEY",
		models: (
			config.providers.local.models as Record<string, unknown>[]
		).map((model) => ({
			...model,
			name: "test-model",
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		})),
	};
	await writeFile(modelsPath, JSON.stringify(config));
	const extension = join(f.agentDir, "auth-fixture.mjs");
	await writeFile(
		extension,
		`export default (pi) => {
		pi.registerProvider("local", {
			...${JSON.stringify(config.providers.local)},
			oauth: {
				name: "Fixture OAuth",
				login() { throw new Error("unused login"); },
				refreshToken() { throw new Error(${JSON.stringify(errorText)}); },
				getApiKey(credential) { return credential.access; }
			}
		});
		pi.on("message_end", (event) => event.message.role === "assistant" && event.message.stopReason === "error"
			? { message: { ...event.message, errorMessage: event.message.errorMessage + " extension " + ${JSON.stringify(errorText)} } } : undefined);
	};`,
	);
	f.options.trustedExtensionPaths = [extension];
}

/** UI と履歴の各境界を個別に検査し、異常系も伏字を取り除かない。 */
function assertSafe(output: string) {
	for (const secret of [apiKey, access, refresh]) {
		assert.ok(!output.includes(secret), "秘密値を公開・保存しない");
	}
}
