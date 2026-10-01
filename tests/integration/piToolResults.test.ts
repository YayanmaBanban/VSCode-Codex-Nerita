// 通常ツールの大きな結果を実 SDK の会話・イベント・保存・独立した復元まで通す。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AgentSession,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { loadTestPiSdk } from "../fixtures/piSdk";
import { piScriptedTools } from "../fixtures/piScriptedTools";
import { sandboxFixture } from "../unit/sandboxFixtures";
import { loadPiResources } from "../../apps/vscode-nerita/src/extension/backends/pi/PiResources";
import { protectPiFeatureTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureToolResults";

const modes = [
	{ codemode: false, toolSearch: false },
	{ codemode: true, toolSearch: false },
	{ codemode: false, toolSearch: true },
	{ codemode: true, toolSearch: true },
];

it.each(modes)(
	"通常結果を保持する: code=$codemode search=$toolSearch",
	async (mode) => {
		const sdk = await loadTestPiSdk();
		const files = await sandboxFixture();
		let session: AgentSession | undefined;
		try {
			const signal = new AbortController().signal;
			const settings = sdk.SettingsManager.inMemory({
				cacheWarming: "off",
				retry: { enabled: false },
				compaction: { enabled: false },
			});
			const features = {
				...mode,
				secrets: () => Promise.resolve(["fixture-private-value"]),
			};
			const loader = await loadPiResources(
				sdk,
				files.cwd,
				files.outside,
				settings,
				() => Promise.resolve(signal),
				signal,
				undefined,
				[],
				files.policy,
				undefined,
				"append",
				[],
				features,
			);
			const runtime = await sdk.ModelRuntime.create({
				authPath: join(files.outside, "auth.json"),
				modelsPath: null,
				modelsStorePath: join(files.outside, "models.json"),
				refreshOnCreate: false,
			});
			await runtime.setRuntimeApiKey("openai", "fixture-key");
			const manager = sdk.SessionManager.create(
				files.cwd,
				join(files.outside, "sessions"),
			);
			let executions = 0;
			const text = JSON.stringify({
				body: "日本語🙂".repeat(60000),
				tail: "end fixture-private-value",
			});
			const image = "AAAA".repeat(70000);
			const tool: ToolDefinition = protectPiFeatureTool(
				{
					name: "fixture_result",
					label: "result",
					description: "return a large result",
					parameters: { type: "object", properties: {} },
					execute: (_id, _params, _signal, update) => {
						executions++;
						const result = {
							content: [
								{ type: "text" as const, text },
								{
									type: "image" as const,
									mimeType: "image/png",
									data: image,
								},
							],
							details: { marker: "tail" },
						};
						update?.(result);
						return Promise.resolve(result);
					},
				},
				features,
			);
			({ session } = await sdk.createAgentSession({
				cwd: files.cwd,
				agentDir: files.outside,
				modelRuntime: runtime,
				model: runtime.getModel("openai", "gpt-6-sol")!,
				settingsManager: settings,
				resourceLoader: loader,
				sessionManager: manager,
				tools: [tool.name],
				customTools: [tool],
			}));
			await session.bindExtensions({ mode: "print" });
			const events: unknown[] = [];
			session.subscribe((event) => events.push(event));
			piScriptedTools(session, [{ name: tool.name, arguments: {} }]);
			await session.prompt("return the result");
			const result = session.messages.find(
				(message) =>
					message.role === "toolResult" &&
					message.toolName === tool.name,
			);
			expect(executions).toBe(1);
			expect(result).toMatchObject({ isError: false });
			expect(result).toMatchObject({
				isError: false,
				content: [
					{
						type: "text",
						text:
							mode.codemode || mode.toolSearch
								? text.replace(
										"fixture-private-value",
										"[非公開]",
									)
								: text,
					},
					{ type: "image", mimeType: "image/png", data: image },
				],
				details: { marker: "tail" },
			});
			const file = manager.getSessionFile()!;
			session.dispose();
			session = undefined;
			const stored = await readFile(file, "utf8");
			expect(
				sdk.SessionManager.open(file).buildSessionContext().messages,
			).toContainEqual(result);
			if (mode.codemode || mode.toolSearch) {
				expect(JSON.stringify(events)).not.toContain(
					"fixture-private-value",
				);
				expect(stored).not.toContain("fixture-private-value");
			}
			expect(executions).toBe(1);
		} finally {
			await session?.abort();
			session?.dispose();
			await files.cleanup();
		}
	},
);
