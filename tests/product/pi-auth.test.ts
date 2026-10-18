// 認証専用パネルと SDK 本体を接続し、保存済み認証を使用できない場合の案内・再試行・秘密値の保護を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import * as vscode from "vscode";
import { type PiAuthRequest, type PiAuthState } from "@nerita/shared/piAuth";
import { createPiAuthService } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAuthService";
import {
	PiAuthFailure,
	piAuthFailure,
} from "../../apps/vscode-nerita/src/extension/backends/pi/PiAuthFailure";
import { credentialFixture } from "../support/credentials";
import { piFixture, until } from "../support/pi";
import { loadPiSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSdk";
import { PiAccountAuthFlow } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccountAuthFlow";

for (const failure of [
	"revoked",
	"reauthenticate",
	"forbidden",
	"network",
] as const) {
	void test(`使用する OAuth の${failure}を専用パネルへ返し、再ログインと再試行を可能にする`, async (t) => {
		const f = await piFixture(t);
		const storage = credentialFixture();
		await saveOAuth(storage, "openai", Date.now() + 3600000);
		const account = storage.vault.selected("openai")!;
		const id = JSON.stringify(["openai", "select", account.id]);
		const states: PiAuthState[] = [];
		const panel = authPanelBoundary(states);
		const service = createPiAuthService(vscode.Uri.file(f.root));
		let attempts = 0;
		const items = () =>
			Promise.resolve([
				{
					id: "openai",
					name: "OpenAI",
					configured: true,
					methods: [
						{ id, name: "使用: 仕事用" },
						{ id: "login", name: "OAuthでログイン" },
					],
				},
			]);
		const opening = service.manage(
			items,
			() => {
				attempts++;
				return attempts === 1
					? Promise.reject(new PiAuthFailure(failure))
					: Promise.resolve();
			},
			new AbortController().signal,
		);
		await until(() => panel.ready());
		panel.receive({ type: "start", id });
		await until(() => states.at(-1)?.active === null);
		const failed = states.at(-1)!;
		const feedback = failed.feedback!.openai!;
		assert.equal(feedback.error?.includes("仕事用"), true);
		assert.equal(feedback.notice, "");
		assert.equal(
			failed.items[0]!.methods.some((method) => method.id === "login"),
			true,
		);
		assert.equal(
			storage.vault.selected("openai")?.id,
			account.id,
			"失敗だけで保存済み認証を削除しない",
		);
		panel.receive({ type: "start", id });
		await until(() => states.at(-1)?.active === null);
		assert.equal(attempts, 2);
		assert.equal(states.at(-1)?.feedback?.openai?.error, null);
		assert.ok(!JSON.stringify(states).includes("fixture-private"));
		panel.close();
		await opening;
	});
}

void test("保存済み OAuth の使用で HTTP 認証拒否をパネルへ伝え、再認証後は失敗表示を解除する", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	await saveOAuth(storage, "openai", Date.now() + 3600000);
	const states: PiAuthState[] = [];
	const panel = authPanelBoundary(states);
	t.after(() => panel.close());
	let rejected = false;
	f.options.credentials = storage.credentials;
	f.options.authService = createPiAuthService(vscode.Uri.file(f.root));
	f.options.request = () =>
		Promise.resolve(
			rejected
				? Response.json(
						{
							error: {
								code: "token_revoked",
								message: "fixture-private-access",
							},
						},
						{ status: 401 },
					)
				: Response.json({ data: [{ id: "gpt-6-luna" }] }),
		);
	const controller = f.controller();
	await controller.connect();
	assert.equal(controller.snapshot().connection, "ready");
	rejected = true;
	const opening = controller.receive({
		type: "auth/start",
		requestId: "auth",
		methodId: "pi",
	});
	await until(() => panel.ready());
	const id = JSON.stringify([
		"openai",
		"select",
		storage.vault.selected("openai")!.id,
	]);
	panel.receive({ type: "start", id });
	await until(() => states.at(-1)?.active === null);
	assert.equal(
		states.at(-1)!.feedback!.openai!.error?.includes("仕事用"),
		true,
	);
	assert.equal(states.at(-1)!.feedback!.openai!.notice, "");
	assert.ok(!JSON.stringify(states).includes("fixture-private"));
	rejected = false;
	panel.receive({ type: "start", id });
	await until(() => states.at(-1)?.active === null);
	assert.equal(states.at(-1)!.feedback!.openai!.error, null);
	panel.close();
	await opening;
});

void test("SDK が包む OAuth 更新拒否を分類し、本文と cause の秘密値を公開しない", () => {
	const privateBody = JSON.stringify({
		error: "invalid_grant",
		error_description: "fixture-private-refresh",
	});
	const sdkError = new Error("OAuth refresh failed for openai", {
		cause: new Error(
			`OpenAI OAuth token request failed (400): ${privateBody}`,
		),
	});
	const failure = piAuthFailure(sdkError);
	assert.equal(failure.kind, "reauthenticate");
	assert.equal(failure.cause, undefined);
	assert.equal(failure.stack?.includes("fixture-private"), false);
	assert.equal(piAuthFailure(new TypeError("fetch failed")).kind, "network");
	assert.equal(
		piAuthFailure(
			new Error(
				'OpenAI OAuth token request failed (400): {"error":"invalid_client"}',
			),
		).kind,
		"reauthenticate",
	);
	assert.equal(
		piAuthFailure(new Error("fixture-private-unknown")).kind,
		"unavailable",
	);
});

void test("使用操作で SDK 本体が更新を拒否した OAuth は成功通知へ進まず、保存値を保持する", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const models = await sdk.ModelRuntime.create({
		credentials: storage.credentials,
		modelsPath: null,
		modelsStorePath: join(f.agentDir, "models-store.json"),
		refreshOnCreate: false,
	});
	models.registerNativeProvider({
		id: "auth-fixture",
		name: "Fixture",
		getModels: () => [],
		stream: () => {
			throw new Error("No model request");
		},
		streamSimple: () => {
			throw new Error("No model request");
		},
		auth: {
			oauth: {
				name: "OAuth",
				login: () => Promise.reject(new Error("No login request")),
				refresh: () =>
					Promise.reject(
						new Error(
							'OpenAI OAuth token request failed (400): {"error":"invalid_grant","error_description":"fixture-private-refresh"}',
						),
					),
				toAuth: (credential) =>
					Promise.resolve({ apiKey: credential.access }),
			},
		},
	});
	await saveOAuth(storage, "auth-fixture", 0);
	const account = storage.vault.selected("auth-fixture")!;
	let changed = false;
	const flow = new PiAccountAuthFlow(
		models,
		{
			manage: async (_items, execute, signal) =>
				execute(
					JSON.stringify(["auth-fixture", "select", account.id]),
					signal,
				),
			interaction: () => ({
				prompt: () => Promise.reject(new Error("No prompt")),
				notify: () => {},
			}),
		},
		undefined,
		storage.credentials,
		() => {},
		() => {
			changed = true;
			return Promise.resolve();
		},
	);
	await assert.rejects(
		flow.authenticate(new AbortController().signal),
		(error: unknown) =>
			error instanceof PiAuthFailure &&
			error.kind === "reauthenticate" &&
			error.cause === undefined,
	);
	assert.equal(changed, false);
	assert.equal(storage.vault.selected("auth-fixture")?.id, account.id);
	assert.equal(
		(await storage.credentials.read("auth-fixture"))?.type,
		"oauth",
	);
});

/** 実ユーザーの認証を使わず、製品の保存経路へ試験専用トークンを登録する。 */
function saveOAuth(
	storage: ReturnType<typeof credentialFixture>,
	provider: string,
	expires: number,
) {
	return storage.credentials.login(
		provider,
		"oauth",
		"session",
		"仕事用",
		() =>
			storage.credentials.modify(provider, () =>
				Promise.resolve({
					type: "oauth",
					access: "fixture-private-access",
					refresh: "fixture-private-refresh",
					expires,
				}),
			),
	);
}

/** VS Code のパネル配送だけを代替し、認証操作の排他・結果公開は本番実装に任せる。 */
function authPanelBoundary(states: PiAuthState[]) {
	let receive: ((message: unknown) => void) | undefined;
	let close: (() => void) | undefined;
	const panel = {
		webview: {
			cspSource: "fixture",
			html: "",
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (listener: (message: unknown) => void) => {
				receive = listener;
				return { dispose() {} };
			},
			postMessage: (state: PiAuthState) => {
				states.push(structuredClone(state));
				return Promise.resolve(true);
			},
		},
		onDidDispose: (listener: () => void) => {
			close = listener;
		},
		dispose: () => close?.(),
	};
	Object.assign(vscode.window, { createWebviewPanel: () => panel });
	Object.assign(vscode.ViewColumn, { Active: 1 });
	Object.assign(vscode.Uri, {
		file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
		joinPath: (base: vscode.Uri, ...parts: string[]) => ({
			fsPath: join(base.fsPath, ...parts),
			toString: () => parts.join("/"),
		}),
	});
	return {
		ready: () => receive !== undefined,
		receive: (message: PiAuthRequest) => receive?.(message),
		close: () => close?.(),
	};
}
