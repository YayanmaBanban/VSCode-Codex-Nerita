// 実 Runtime と Controller を通し、Extension Host でも接続・子承認・Stop を確認する。
import * as assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { PiSessionController } from "../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import { createPiRuntime } from "../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import { sandboxFixture } from "./unit/sandboxFixtures";
import { piHttpMcpFixture } from "./fixtures/piHttpMcp";
import { piScriptedTools } from "./fixtures/piScriptedTools";

/** 接続時に承認を要求せず、実行中の既存 Permission UI から許可する。 */
export async function piMcpSmoke(extensionPath: string): Promise<void> {
	const files = await sandboxFixture();
	const remote = await piHttpMcpFixture();
	let agent: AgentSession;
	const controller = new PiSessionController(async (signal, authorize) => {
		const session = await createPiRuntime({
			extensionPath,
			cwd: files.cwd,
			agentDir: files.outside,
			signal,
			authorize,
			storage: "workspace",
			trustStore: files.trustStore,
			workspaceTrusted: true,
			executor: null,
			parentPolicy: {
				...files.policy,
				networkAccess: true,
				shell: false,
			},
			preferredModel: { provider: "fixture", model: "fixture" },
			codemode: true,
			toolSearch: true,
			allowedTools: ["codemode", "tool_search", "mcp__fixture__change"],
		});
		agent = session as unknown as AgentSession;
		return { session, cwd: files.cwd };
	});
	/** UI と同じ ID 検査を通し、古い承認を流用しない。 */
	const answer = async (accept: boolean) => {
		const state = controller.snapshot();
		await controller.receive({
			type: "permission/respond",
			requestId: `permission-${state.permissions[0]!.id}`,
			sessionId: state.sessionId,
			runId: state.runId,
			permissionId: state.permissions[0]!.id,
			optionId: accept ? "accept" : "decline",
		});
	};
	/** 模擬モデルは選択だけを行い、MCP の操作は実通信で行う。 */
	const submit = async (path: string) => {
		piScriptedTools(agent, [
			{ name: "tool_search", arguments: { query: "change records" } },
			{
				name: "codemode",
				arguments: {
					code: `text(await tools.mcp__fixture__change({ path: ${JSON.stringify(path)} }));`,
				},
			},
		]);
		await controller.receive({
			type: "prompt/send",
			requestId: path,
			sessionId: controller.snapshot().sessionId,
			text: path,
		});
	};
	try {
		await writeFile(
			join(files.outside, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					fixture: {
						enabled: true,
						exposure: "deferred",
						url: remote.url,
						headers: { Authorization: `Bearer ${remote.token}` },
					},
				},
			}),
		);
		await writeFile(
			join(files.outside, "models.json"),
			JSON.stringify({
				providers: {
					fixture: {
						api: "openai-completions",
						baseUrl: "http://127.0.0.1:1/v1",
						apiKey: "fixture-only",
						models: [
							{
								id: "fixture",
								reasoning: false,
								input: ["text"],
								contextWindow: 8192,
								maxTokens: 256,
							},
						],
					},
				},
			}),
		);
		await controller.connect();
		assert.equal(
			controller.snapshot().connection,
			"ready",
			controller.snapshot().error ?? undefined,
		);
		assert.equal(controller.snapshot().permissions.length, 0);
		assert.equal(remote.methods.length, 0);
		await submit("approved.txt");
		for (let count = 0; count < 3; count++) {
			await until(() => controller.snapshot().permissions.length === 1);
			assert.equal(remote.calls.length, 0);
			await answer(true);
		}
		await until(() => controller.snapshot().run !== "running");
		assert.equal(
			remote.calls.length,
			1,
			JSON.stringify(controller.snapshot().tools),
		);
		assert.ok(
			JSON.stringify(controller.snapshot().tools).includes("codemode"),
		);
		assert.ok(
			!JSON.stringify(controller.snapshot()).includes(remote.token),
		);
		const history = agent!.sessionManager.getSessionFile()!;
		assert.ok(!(await readFile(history, "utf8")).includes(remote.token));
		await submit("denied.txt");
		await until(() => controller.snapshot().permissions.length === 1);
		await answer(false);
		await until(() => controller.snapshot().run !== "running");
		assert.equal(remote.calls.length, 1);
		await submit("stopped.txt");
		await until(() => controller.snapshot().permissions.length === 1);
		const state = controller.snapshot();
		await controller.receive({
			type: "prompt/cancel",
			requestId: "stop-mcp",
			sessionId: state.sessionId,
			runId: state.runId,
		});
		await until(() => controller.snapshot().run === "cancelled");
		assert.equal(remote.calls.length, 1);
	} finally {
		await controller.dispose();
		await remote.close();
		await files.cleanup();
	}
}

/** UI の状態反映を待ち、期限切れを検証失敗として扱う。 */
async function until(check: () => boolean): Promise<void> {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.ok(Date.now() < end, "MCP の状態更新が期限を超えました。");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
