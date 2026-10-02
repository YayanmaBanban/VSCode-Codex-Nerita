// 本番のコントローラー・配布用 SDK・専用保存領域を接続し、操作と後片付けだけを共通化する。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { TestContext } from "node:test";
import { type ModelReply, modelServer } from "./modelServer";
import { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import {
	createPiRuntime,
	type PiRuntimeOptions,
} from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import type { PiSessionStorage } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionStore";

/** 期待する製品状態まで待ち、期限切れでは最後の状態も失敗として返す。 */
export async function until(
	condition: () => boolean,
	detail: () => unknown = condition,
) {
	const deadline = Date.now() + 15000;
	while (!condition() && Date.now() < deadline) {
		await setTimeout(10);
	}
	assert.ok(condition(), JSON.stringify(detail()));
}

/** 認証済みモデルやユーザーの設定を使わず、新しい作業領域を用意する。 */
export async function piFixture(t: TestContext) {
	assert.ok(
		process.env.NERITA_TEST_ROOT && process.env.NERITA_TEST_EXTENSION,
		"pnpm test:product から実行してください。",
	);
	const root = await mkdtemp(join(process.env.NERITA_TEST_ROOT, "scenario-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent");
	await Promise.all([mkdir(cwd), mkdir(agentDir)]);
	const model = await modelServer();
	t.after(() => model.close());
	await writeFixturePiModel(agentDir, model);
	const trust = new WorkspaceTrustStore({
		read: () => undefined,
		write: () => Promise.resolve(),
	});
	await trust.setUserTrust(cwd, true);
	const controllers: PiSessionController[] = [];
	t.after(async () => {
		for (const controller of controllers) {
			await controller.dispose();
		}
	});
	let storage: PiSessionStorage = "workspace";
	const options: Partial<PiRuntimeOptions> = {};
	return {
		root,
		cwd,
		agentDir,
		model,
		trust,
		options,
		storage: (next: PiSessionStorage) => {
			storage = next;
		},
		controller: (afterCreate?: () => Promise<void>) => {
			const controller = new PiSessionController(
				async (signal, authorize, resume) => {
					const session = await createPiRuntime({
						extensionPath: process.env.NERITA_TEST_EXTENSION!,
						cwd,
						agentDir,
						preferredModel: {
							provider: "local",
							model: "test-model",
						},
						executor: null,
						workspaceTrusted: true,
						workspaceRoots: [cwd],
						trustStore: trust,
						getStorage: () => storage,
						...options,
						signal,
						authorize,
						...(resume ? { resume } : {}),
					});
					await afterCreate?.();
					return { cwd, session };
				},
			);
			controllers.push(controller);
			return controller;
		},
	};
}

/** ユーザーのモデル設定に触れず、ローカルの HTTP 境界だけを登録する。 */
function writeFixturePiModel(
	agentDir: string,
	model: {
		url: string;
		requests: string[];
		replies: ModelReply[];
		close: () => Promise<void>;
	},
) {
	return writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: model.url,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: [
						{
							id: "test-model",
							reasoning: false,
							input: ["text", "image"],
							contextWindow: 1000000,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
}

/** 画面と同じ検証済みメッセージで送信する。 */
export async function send(controller: PiSessionController, text: string) {
	const request = {
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		text,
	};
	await controller.receive(request);
	return request;
}

/** 実際に表示された承認要求へ返答する。 */
export async function permission(
	controller: PiSessionController,
	optionId: string,
) {
	await until(
		() => controller.snapshot().permissions.length > 0,
		() => controller.snapshot(),
	);
	const state = controller.snapshot();
	await controller.receive({
		type: "permission/respond",
		requestId: randomUUID(),
		sessionId: state.sessionId,
		runId: state.runId,
		permissionId: state.permissions[0]!.id,
		optionId,
	});
}

/** 完了待ちはエラーを握りつぶさず、後続のアサーションへ状態を返す。 */
export async function finished(controller: PiSessionController) {
	await until(
		() => !["running", "cancelling"].includes(controller.snapshot().run),
		() => controller.snapshot(),
	);
	return controller.snapshot();
}

/** 保存形式を決め打ちせず、製品が実際に作成した会話ファイルを読む。 */
export async function sessionFiles(cwd: string) {
	const directory = join(cwd, ".pi/sessions");
	const names = (await readdir(directory)).filter((name) =>
		name.endsWith(".jsonl"),
	);
	return Promise.all(
		names.map(async (name) => ({
			path: join(directory, name),
			text: await readFile(join(directory, name), "utf8"),
		})),
	);
}
