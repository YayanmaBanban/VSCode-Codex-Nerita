// 同梱SDKにCLI形式のパッケージ設定を渡し、承認と登録リソースを検証する。
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** ユーザーの設定には触れず、隔離したglobal/projectパッケージを読み込む。 */
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
	let allowed = false;
	let approvals = 0;
	const abort = new AbortController();
	const session = await createPiRuntime({
		extensionPath,
		cwd,
		agentDir,
		provider: "local",
		model: "smoke",
		signal: abort.signal,
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
			extensions.some((extension) =>
				extension.path.endsWith("local.ts"),
			),
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
		assert.deepEqual(await readdir(localExtensions), ["local.ts"]);
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
