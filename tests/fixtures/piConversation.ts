// 実 SDK の会話と保存を接続し、モデル応答だけをローカルで代替する。
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { HostMessage } from "@nerita/shared/messages";
import { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import { createPiRuntime } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import type { PiSessionStorage } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionStore";
import { loadTestPiSdk } from "./piSdk";
import { piScriptedTools } from "./piScriptedTools";
import { sandboxFixture } from "../unit/sandboxFixtures";

/** 各起動で本番 Runtime を作り、入力文脈・通知・ファイルを外から観測する。 */
export async function piConversation() {
	const sdk = await loadTestPiSdk();
	const files = await sandboxFixture();
	const configuration = {
		cwd: files.cwd,
		storage: "global" as PiSessionStorage,
	};
	const contexts: string[] = [];
	const events: HostMessage[] = [];
	const controllers: PiSessionController[] = [];
	const cleanup = async () => {
		try {
			await Promise.all(
				controllers.map((controller) => controller.dispose()),
			);
		} finally {
			await files.cleanup();
		}
	};
	try {
		await writeFile(
			join(files.outside, "models.json"),
			JSON.stringify({
				providers: {
					local: {
						baseUrl: "http://127.0.0.1:1/v1",
						api: "openai-completions",
						apiKey: "fixture-key",
						models: [
							{
								id: "fixture",
								name: "Fixture",
								reasoning: false,
								input: ["text"],
								contextWindow: 8192,
								maxTokens: 128,
							},
						],
					},
				},
			}),
		);
	} catch (error) {
		await cleanup();
		throw error;
	}
	const create = () => {
		const controller = new PiSessionController(
			async (signal, authorize, resume) => {
				const runtime = await createPiRuntime({
					extensionPath: dirname(
						dirname(dirname(process.env.NERITA_TEST_PI_ENTRY!)),
					),
					cwd: configuration.cwd,
					agentDir: files.outside,
					signal,
					authorize,
					...(resume ? { resume } : {}),
					storage: configuration.storage,
					getStorage: () => configuration.storage,
					preferredModel: { provider: "local", model: "fixture" },
					trustStore: files.trustStore,
					workspaceTrusted: true,
					executor: null,
					sandboxUnavailable: "保存検証ではシェルを実行しない",
					allowedTools: [],
				});
				const session = runtime as typeof runtime & AgentSession;
				piScriptedTools(session, []);
				const stream = session.agent.streamFunction;
				session.agent.streamFunction = (...args) => {
					contexts.push(JSON.stringify(args[1].messages));
					return stream(...args);
				};
				return { session, cwd: configuration.cwd };
			},
		);
		controller.subscribe((event) => events.push(event));
		controllers.push(controller);
		return controller;
	};
	return { ...files, sdk, configuration, contexts, events, create, cleanup };
}
