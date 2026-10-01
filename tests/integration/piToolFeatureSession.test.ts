// 実 SDK の会話ループで検索・子呼出し・履歴保存を確認し、通信だけを模擬する。
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentSession,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import type { PiFeatureSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiBuiltinExtensions";
import { loadPiResources } from "../../apps/vscode-nerita/src/extension/backends/pi/PiResources";
import { approvePiTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiApprovedTools";
import { piToolExposure } from "../../apps/vscode-nerita/src/extension/backends/pi/PiToolFeatures";
import { sandboxFixture } from "../unit/sandboxFixtures";
import { protectPiFeatureTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureToolResults";

/** 実モデル応答の代わりに、検索・コード・完了の順で応答する。 */
function scriptedStream(session: AgentSession) {
	let turn = 0;
	session.agent.streamFunction = (model) => {
		const calls = [
			{
				type: "toolCall" as const,
				id: "search",
				name: "tool_search",
				arguments: { query: "change records" },
			},
			{
				type: "toolCall" as const,
				id: "code",
				name: "codemode",
				arguments: {
					code: 'text(await tools.fixture_change({ path: "actual.txt" })); store("saved", 7);',
				},
			},
		];
		const call = calls[turn++];
		const message = {
			role: "assistant" as const,
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: call ? [call] : [{ type: "text" as const, text: "done" }],
			stopReason: call ? ("toolUse" as const) : ("stop" as const),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			timestamp: Date.now(),
		};
		const stream = {
			async *[Symbol.asyncIterator]() {
				await Promise.resolve();
				yield { type: "start", partial: message };
				yield { type: "done", reason: message.stopReason, message };
			},
			result: () => Promise.resolve(message),
		};
		return stream as unknown as ReturnType<
			typeof session.agent.streamFunction
		>;
	};
}

it("検索したHostツールの実引数を承認し、子の親IDと要約を保存して復元する", async () => {
	const files = await sandboxFixture();
	const directory = files.cwd;
	const sdk = (await import(
		/* @vite-ignore */ pathToFileURL(
			resolve("apps/vscode-nerita/dist/runtime/pi.mjs"),
		).href
	)) as PiFeatureSdk;
	let session: AgentSession | undefined;
	let executed = 0;
	const approvals: string[] = [];
	const authorize = (request: unknown, signal?: AbortSignal) => {
		approvals.push(JSON.stringify(request));
		return Promise.resolve(signal ?? new AbortController().signal);
	};
	try {
		const settings = sdk.SettingsManager.inMemory({
			cacheWarming: "off",
			retry: { enabled: false, provider: { maxRetries: 0 } },
			compaction: { enabled: false },
		});
		const loader = await loadPiResources(
			sdk,
			directory,
			directory,
			settings,
			authorize,
			new AbortController().signal,
			undefined,
			[],
			files.policy,
			undefined,
			"append",
			[],
			{
				codemode: true,
				toolSearch: true,
				secrets: () => Promise.resolve(["fixture-private-value"]),
			},
		);
		const runtime = await sdk.ModelRuntime.create({
			authPath: join(directory, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(directory, "models.json"),
			refreshOnCreate: false,
		});
		await runtime.setRuntimeApiKey("openai", "fixture-key");
		const model = runtime.getModel("openai", "gpt-6-sol")!;
		const tool: ToolDefinition = protectPiFeatureTool(
			piToolExposure(
				approvePiTool(
					{
						name: "fixture_change",
						label: "change",
						description: "change records",
						parameters: {
							type: "object",
							properties: { path: { type: "string" } },
							required: ["path"],
						},
						execute: () => {
							executed++;
							return Promise.resolve({
								content: [
									{
										type: "text",
										text: "changed fixture-private-value",
									},
								],
								details: {},
							});
						},
					},
					directory,
					authorize,
					files.policy,
				),
				{ toolSearch: true },
			),
			{
				codemode: true,
				secrets: () => Promise.resolve(["fixture-private-value"]),
			},
		);
		const manager = sdk.SessionManager.create(
			directory,
			join(directory, "sessions"),
		);
		const sessionOptions = {
			cwd: directory,
			agentDir: directory,
			modelRuntime: runtime,
			model,
			settingsManager: settings,
			resourceLoader: loader,
			sessionManager: manager,
			tools: ["codemode", "tool_search", "fixture_change"],
			neritaAllowedToolNames: new Set([
				"codemode",
				"tool_search",
				"fixture_change",
			]),
			neritaActiveToolNames: ["codemode", "tool_search"],
			customTools: [tool],
		};
		({ session } = await sdk.createAgentSession(sessionOptions));
		await session.bindExtensions({ mode: "print" });
		expect(session.getActiveToolNames()).not.toContain("fixture_change");
		scriptedStream(session);
		const events: unknown[] = [];
		session.subscribe((event) => events.push(event));
		await session.prompt("change records");
		expect(JSON.stringify(events)).not.toContain("fixture-private-value");
		expect(executed, JSON.stringify(session.messages)).toBe(1);
		expect(approvals).toHaveLength(2);
		expect(approvals[1]).toContain("actual.txt");
		expect(session.getActiveToolNames()).toContain("fixture_change");
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool_execution_start",
				toolName: "fixture_change",
				parentToolCallId: "code",
			}),
		);
		const result = session.messages.find(
			(message) =>
				message.role === "toolResult" && message.toolCallId === "code",
		);
		expect(result).toMatchObject({
			nestedCalls: {
				complete: true,
				calls: [
					{
						id: "code/1",
						name: "fixture_change",
						status: "ok",
						arguments: { path: "actual.txt" },
					},
				],
			},
		});
		const file = manager.getSessionFile()!;
		session.dispose();
		session = undefined;
		const restored = sdk.SessionManager.open(file);
		expect(restored.buildSessionContext().messages).toContainEqual(result);
		expect(restored.getBranch()).toContainEqual(
			expect.objectContaining({
				type: "custom",
				customType: "codemode-store",
				data: { set: { saved: 7 }, delete: [] },
			}),
		);
		expect(executed).toBe(1);
	} finally {
		session?.dispose();
		await files.cleanup();
	}
});
