// 同梱 SDK に CLI 形式のパッケージ設定を渡し、承認と登録リソースを検証する。
import assert from "node:assert/strict";
import {
	mkdir,
	writeFile,
	readFile,
	readdir,
	realpath,
} from "node:fs/promises";
import path from "node:path";

/** ユーザーの設定には触れず、隔離した `global/project` パッケージを読み込む。 */
export async function piPackagesSmoke({
	createPiRuntime,
	sdk,
	extensionPath,
	cwd,
	agentDir,
	requests,
}) {
	const packageDir = path.join(agentDir, "test-package");
	await mkdir(path.join(packageDir, "skills", "package-skill"), {
		recursive: true,
	});
	await mkdir(path.join(packageDir, "prompts"), { recursive: true });
	await writeFile(
		path.join(packageDir, "package.json"),
		JSON.stringify({
			name: "nerita-test-package",
			pi: {
				extensions: ["extension.mjs"],
				skills: ["skills"],
				prompts: ["prompts"],
			},
		}),
	);
	await writeFile(
		path.join(packageDir, "skills/package-skill/SKILL.md"),
		"---\nname: package-skill\ndescription: Smoke package skill\n---\nPackage skill instructions.\n",
	);
	await writeFile(
		path.join(packageDir, "prompts/package-prompt.md"),
		"---\ndescription: Smoke prompt\n---\nPackage prompt $1",
	);
	await writeFile(
		path.join(packageDir, "extension.mjs"),
		`
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
export default function(pi) {
  pi.on("session_start", () => { pi.appendEntry("package-started", { loaded: true }); });
  pi.registerTool({ name: "package_tool", label: "Package", description: "Package test", parameters: { type: "object", properties: {} }, async execute(id, params, signal, update, ctx) {
    await writeFile(join(ctx.cwd, "package-tool.txt"), "executed");
    return { content: [{ type: "text", text: "package done" }], details: {} };
  }});
}`,
	);
	await writeFile(
		path.join(agentDir, "settings.json"),
		JSON.stringify({ packages: [packageDir] }),
	);
	await mkdir(path.join(cwd, ".pi"), { recursive: true });
	const localExtensions = path.join(cwd, ".pi/extensions");
	await mkdir(localExtensions, { recursive: true });
	const localExtensionSource = `export default function(pi) {
  pi.on("session_start", () => { pi.appendEntry("local-started", { loaded: true }); });
  pi.on("before_provider_request", (event) => ({ ...event.payload, neritaLocalSmoke: true }));
}`;
	await writeFile(
		path.join(localExtensions, "local.ts"),
		localExtensionSource,
	);
	await writeFile(
		path.join(cwd, ".pi/settings.json"),
		JSON.stringify({ packages: [packageDir] }),
	);
	const untrusted = path.join(localExtensions, "untrusted.mjs");
	await writeFile(
		untrusted,
		"throw new Error('UNTRUSTED_EXTENSION_LOADED'); export default () => {};\n",
	);
	let allowed = false;
	let approvals = 0;
	const abort = new AbortController();
	const catalogRequests = [];
	const session = await createPiRuntime({
		extensionPath,
		cwd,
		agentDir,
		preferredModel: { provider: "local", model: "smoke" },
		trustedExtensionPaths: await Promise.all(
			[
				path.join(packageDir, "extension.mjs"),
				path.join(localExtensions, "local.ts"),
			].map((entry) => realpath(entry)),
		),
		signal: abort.signal,
		request: async (url, options) => {
			catalogRequests.push(String(url));
			assert.equal(options.redirect, "error");
			assert.equal(
				options.headers["ChatGPT-Account-Id"],
				"smoke-account",
			);
			if (String(url).includes("/wham/usage")) {
				return new Response(null, { status: 503 });
			}
			assert.ok(
				String(url).startsWith(
					"https://chatgpt.com/backend-api/codex/models?client_version=",
				),
			);
			return Response.json({
				models: [
					{
						slug: "controls-test",
						display_name: "Live Controls",
						priority: 0,
						visibility: "list",
						default_reasoning_level: "high",
						supported_reasoning_levels: [
							"low",
							"high",
							"max",
							"ultra",
						].map((effort) => ({ effort })),
						service_tiers: [
							{
								id: "priority",
								name: "Fast",
								description: "Smoke priority",
							},
						],
					},
				],
			});
		},
		authorize: () => {
			approvals++;
			return allowed
				? Promise.resolve(abort.signal)
				: Promise.reject(new Error("denied"));
		},
	});
	try {
		const extensions = session.resourceLoader.getExtensions().extensions;
		assert.equal(
			extensions.filter(
				(extension) =>
					extension.path === "<inline:nerita-provider-controls>",
			).length,
			1,
		);
		assert.ok(
			extensions.some((extension) => extension.path.endsWith("local.ts")),
		);
		assert.ok(
			session.sessionManager
				.getEntries()
				.some(
					(entry) =>
						entry.type === "custom" &&
						entry.customType === "local-started",
				),
		);
		assert.deepEqual((await readdir(localExtensions)).sort(), [
			"local.ts",
			"untrusted.mjs",
		]);
		assert.ok(
			!extensions.some((extension) =>
				extension.path.endsWith("untrusted.mjs"),
			),
		);
		assert.equal(
			await readFile(path.join(localExtensions, "local.ts"), "utf8"),
			localExtensionSource,
		);
		assert.equal(
			session.skills.filter((skill) => skill.name === "package-skill")
				.length,
			1,
		);
		assert.equal(
			session.sessionManager
				.getEntries()
				.filter(
					(entry) =>
						entry.type === "custom" &&
						entry.customType === "package-started",
				).length,
			1,
		);
		assert.ok(session.getActiveToolNames().includes("package_tool"));
		const tool = session.agent.state.tools.find(
			(item) => item.name === "package_tool",
		);
		assert.ok(tool);
		await assert.rejects(
			tool.execute("denied", {}, abort.signal),
			/denied/,
		);
		await assert.rejects(readFile(path.join(cwd, "package-tool.txt")), {
			code: "ENOENT",
		});
		allowed = true;
		await tool.execute("allowed", {}, abort.signal);
		assert.equal(
			await readFile(path.join(cwd, "package-tool.txt"), "utf8"),
			"executed",
		);
		assert.equal(approvals, 2);
		assert.ok(
			session.resourceLoader
				.getPrompts()
				.prompts.some((prompt) => prompt.name === "package-prompt"),
		);
		await session.prompt("/package-prompt expanded");
		assert.equal(requests.at(-1).neritaLocalSmoke, true);
		assert.ok(
			JSON.stringify(requests.at(-1).messages).includes(
				"Package prompt expanded",
			),
		);
		await session.prompt("/skill:package-skill");
		assert.ok(
			JSON.stringify(requests.at(-1).messages).includes(
				"Package skill instructions.",
			),
		);
		const originalId = session.sessionId;
		await session.account.selectModel("local/smoke", abort.signal);
		assert.equal(session.sessionId, originalId);
		assert.equal(session.account.snapshot().connection, "ready");
		// 実 SDK のメタデータによる候補生成と、ユーザー拡張を含む要求フックの合成を検証する。
		// 外部プロバイダーには送信せず、隔離した認証・モデルと SDK の公開 `Runner` を使う。
		const controlsModel = {
			id: "controls-test",
			name: "Controls test",
			reasoning: true,
			input: ["text"],
			contextWindow: 32000,
			maxTokens: 1000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			thinkingLevelMap: {
				off: null,
				minimal: null,
				low: "low",
				medium: null,
				high: "high",
				xhigh: null,
				max: "max",
			},
		};
		session.modelRuntime.registerProvider("openai-codex", {
			api: "openai-codex-responses",
			apiKey: "isolated-controls-key",
			baseUrl: "https://example.invalid",
			models: [
				controlsModel,
				{ ...controlsModel, id: "controls-new", name: "New Pi model" },
			],
		});
		// OAuth の解決境界だけを模擬し、catalog parser・overlay・SDK 操作は実装を通す。
		const isUsingOAuth = session.modelRuntime.isUsingOAuth.bind(
			session.modelRuntime,
		);
		const getAuth = session.modelRuntime.getAuth.bind(session.modelRuntime);
		const checkAuth = session.modelRuntime.checkAuth.bind(
			session.modelRuntime,
		);
		const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "smoke-account" } })).toString("base64url")}.smoke`;
		session.modelRuntime.isUsingOAuth = (provider) =>
			provider === "openai-codex" || isUsingOAuth(provider);
		session.modelRuntime.getAuth = (provider, options) =>
			provider === "openai-codex"
				? Promise.resolve({ auth: { apiKey: token } })
				: getAuth(provider, options);
		session.modelRuntime.checkAuth = (provider, options) =>
			provider === "openai-codex"
				? Promise.resolve({ type: "oauth" })
				: checkAuth(provider, options);
		await session.account.selectModel(
			"openai-codex/controls-test",
			abort.signal,
		);
		assert.deepEqual(session.getAvailableThinkingLevels(), [
			"low",
			"high",
			"max",
		]);
		assert.equal(
			session.account.snapshot().configOptions[0].options[0].name,
			"Live Controls",
		);
		assert.ok(
			!session.account
				.snapshot()
				.configOptions[0].options.some(
					(option) => option.value === "openai-codex/controls-new",
				),
		);
		assert.equal(await session.quota.read(abort.signal), null);
		assert.equal(
			session.account.snapshot().configOptions[0].options[0].name,
			"Live Controls",
		);
		assert.equal(catalogRequests.length, 2);
		await session.account.configure(
			"reasoning_effort",
			"ultra",
			abort.signal,
		);
		await session.account.configure("fast-mode", "on", abort.signal);
		assert.equal(session.thinkingLevel, "max");
		assert.equal(
			session.account.snapshot().piProviderControls.effectiveReasoning,
			"ultra",
		);
		const rewritten =
			await session.extensionRunner.emitBeforeProviderRequest({
				reasoning: { effort: "max", summary: "auto" },
				input: [],
			});
		assert.equal(rewritten.reasoning.effort, "ultra");
		assert.equal(rewritten.reasoning.summary, "auto");
		assert.equal(rewritten.service_tier, "priority");
		assert.equal(rewritten.neritaLocalSmoke, true);
		await session.account.configure("fast-mode", "off", abort.signal);
		assert.equal(
			session.account.snapshot().piProviderControls.effectiveReasoning,
			"ultra",
		);
		await assert.rejects(
			session.account.selectModel(
				"openai-codex/controls-new",
				abort.signal,
			),
		);
		assert.equal(session.model.id, "controls-test");
		await session.account.selectModel("local/smoke", abort.signal);
		assert.equal(
			session.account.snapshot().piProviderControls.reasoningOverride,
			null,
		);
		assert.equal(
			session.account.snapshot().piProviderControls.fastMode,
			false,
		);
		const localPayload =
			await session.extensionRunner.emitBeforeProviderRequest({
				messages: [],
			});
		assert.equal(localPayload.service_tier, undefined);
		assert.equal(localPayload.reasoning, undefined);
		assert.equal(localPayload.neritaLocalSmoke, true);
	} finally {
		session.dispose();
	}
	const models = await sdk.ModelRuntime.create({
		authPath: path.join(agentDir, "test-auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	models.registerNativeProvider({
		id: "test-auth",
		name: "Test Auth",
		getModels: () => [],
		auth: {
			apiKey: {
				name: "Test key",
				login: async (interaction) => ({
					type: "api_key",
					key: await interaction.prompt({
						type: "secret",
						message: "key",
					}),
				}),
				resolve: () => undefined,
			},
		},
	});
	await models.login("test-auth", "api_key", {
		signal: abort.signal,
		prompt: () => Promise.resolve("isolated-test-key"),
		notify: () => {},
	});
	assert.ok(
		(await models.listCredentials()).some(
			(item) => item.providerId === "test-auth",
		),
	);
	await models.logout("test-auth");
	assert.ok(
		!(await models.listCredentials()).some(
			(item) => item.providerId === "test-auth",
		),
	);
	console.log(
		"PASS: packaged Pi → package deduplication → extension startup → skills/prompts → tool approval/rejection → model selection → API key login/logout",
	);
}
