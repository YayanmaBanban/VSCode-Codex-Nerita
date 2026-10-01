// 同梱 SDK で保存・再開・保存先切替を検証する。会話はローカルモデルだけを使う。
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** 新しい `Controller` から同じ履歴を開き、UI とモデルの両方へ文脈を復元する。 */
export async function piPersistenceSmoke({
	PiSessionController,
	createPiRuntime,
	sdk,
	extensionPath,
	cwd,
	agentDir,
	requests,
}) {
	let storage = "global";
	let workspace = cwd;
	let sequence = 0;
	let controller;
	let runtime;
	const create = () =>
		new PiSessionController(async (signal, authorize, resume) => {
			const session = await createPiRuntime({
				extensionPath,
				cwd: workspace,
				agentDir,
				storage,
				getStorage: () => storage,
				signal,
				authorize,
				resume,
				preferredModel: { provider: "local", model: "smoke" },
			});
			runtime = session;
			return { cwd: workspace, session };
		});
	const receive = (message) =>
		controller.receive({ requestId: `history-${++sequence}`, ...message });
	const list = () => receive({ type: "session/list" });
	const load = (sessionId) => receive({ type: "session/load", sessionId });
	const send = async (text) => {
		await receive({
			type: "prompt/send",
			sessionId: controller.snapshot().sessionId,
			text,
		});
		await until(() => controller.snapshot().run !== "running");
		assert.equal(
			controller.snapshot().run,
			"completed",
			controller.snapshot().error,
		);
	};
	try {
		controller = create();
		await controller.connect();
		await list();
		assert.equal(controller.snapshot().sessions.length, 1);
		const savedId = controller.snapshot().sessions[0].sessionId;
		await load(savedId);
		assert.equal(controller.snapshot().sessionId, savedId);
		assert.ok(
			controller.snapshot().messages.some((m) => m.text === "hello"),
		);
		assert.ok(
			controller
				.snapshot()
				.tools.some(
					(t) => t.kind === "read" && t.status === "completed",
				),
		);
		assert.ok(
			controller
				.snapshot()
				.tools.some((t) => t.kind === "edit" && t.status === "failed"),
		);
		assert.equal(controller.snapshot().permissions.length, 0);
		assert.ok(
			controller.snapshot().tools.some((t) => t.status === "cancelled"),
		);
		assert.equal(controller.snapshot().runId, null);
		assert.ok(
			controller
				.snapshot()
				.tools.every(
					(t) => !["pending", "in_progress"].includes(t.status),
				),
		);
		await send("resume saved context");
		assert.ok(
			requests
				.at(-1)
				.messages.some(
					(m) =>
						m.role === "user" &&
						JSON.stringify(m.content).includes("hello"),
				),
		);
		assert.ok(requests.at(-1).messages.some((m) => m.role === "tool"));
		const standardDirectory = runtime.history.target(savedId).directory;
		const standardFile = (
			await sdk.SessionManager.listAll(standardDirectory)
		).find((row) => row.id === savedId).path;
		const original = await readFile(standardFile, "utf8");
		assert.ok(original.includes("resume saved context"));
		// 設定変更だけで開いている履歴を移動せず、新規会話から切り替える。
		storage = "workspace";
		await receive({ type: "session/new" });
		const localId = controller.snapshot().sessionId;
		assert.notEqual(localId, savedId);
		await list();
		assert.equal(controller.snapshot().sessions.length, 0);
		await send("local history");
		await list();
		assert.deepEqual(
			controller.snapshot().sessions.map((row) => row.sessionId),
			[localId],
		);
		assert.equal(await readFile(standardFile, "utf8"), original);
		await controller.dispose();
		controller = create();
		await controller.connect();
		await list();
		await load(localId);
		assert.equal(controller.snapshot().sessionId, localId);
		await send("after restart");
		await controller.dispose();
		// 完了通知がないツールは、復元時に停止表示へ落とし承認・実行しない。
		await controller.dispose();
		const localDir = runtime.history.target(localId).directory;
		const incomplete = sdk.SessionManager.create(workspace, localDir);
		incomplete.appendMessage({
			role: "user",
			content: "interrupted operation",
			timestamp: Date.now(),
		});
		const assistant = JSON.parse(
			original
				.split("\n")
				.find((line) => line.includes('"role":"assistant"')),
		).message;
		incomplete.appendMessage({
			...assistant,
			content: [
				{
					type: "toolCall",
					id: "unfinished",
					name: "write",
					arguments: { path: "must-not-exist.txt", content: "bad" },
				},
			],
			stopReason: "toolUse",
		});
		controller = create();
		await controller.connect();
		await list();
		await load(incomplete.getSessionId());
		assert.equal(controller.snapshot().tools.at(-1).status, "cancelled");
		assert.deepEqual(controller.snapshot().permissions, []);
		await send("resume incomplete turn");
		await assert.rejects(
			readFile(path.join(workspace, "must-not-exist.txt")),
			{ code: "ENOENT" },
		);
		// 自動接続後・初回送信前の設定変更を、独立したワークスペースで再現する。
		await controller.dispose();
		workspace = path.join(
			path.dirname(cwd),
			"storage change before first prompt",
		);
		await mkdir(workspace);
		storage = "global";
		controller = create();
		await controller.connect();
		const globalDir = runtime.history.target(runtime.sessionId).directory;
		storage = "workspace";
		await send("first prompt after storage change");
		const switchedId = controller.snapshot().sessionId;
		const switchedDir = runtime.history.target(switchedId).directory;
		const switchedFile = (
			await sdk.SessionManager.listAll(switchedDir)
		).find((row) => row.id === switchedId).path;
		assert.ok(
			(await readFile(switchedFile, "utf8")).includes(
				"first prompt after storage change",
			),
		);
		assert.deepEqual(await sdk.SessionManager.listAll(globalDir), []);
		// 送信済みの会話は途中で設定を変えても同じファイルへ追記する。
		storage = "global";
		await send("continue in workspace storage");
		assert.equal(controller.snapshot().sessionId, switchedId);
		assert.ok(
			(await readFile(switchedFile, "utf8")).includes(
				"continue in workspace storage",
			),
		);
		// 逆方向も未送信の新規会話にだけ適用する。
		storage = "workspace";
		await receive({ type: "session/new" });
		storage = "global";
		await send("first prompt in global storage");
		assert.deepEqual(
			(await sdk.SessionManager.listAll(switchedDir)).map(
				(row) => row.id,
			),
			[switchedId],
		);
		assert.deepEqual(
			(await sdk.SessionManager.listAll(globalDir)).map((row) => row.id),
			[controller.snapshot().sessionId],
		);
		console.log(
			"PASS: Pi global/workspace persistence → incomplete tools → first-prompt storage changes in both directions",
		);
		await startupReasoningSmoke({
			createPiRuntime,
			extensionPath,
			cwd: workspace,
			agentDir,
		});
	} finally {
		await controller?.dispose();
	}
}

/** `Controller` による後処理なしでも、新しい SDK セッションが保存推論で起動する。 */
async function startupReasoningSmoke({
	createPiRuntime,
	extensionPath,
	cwd,
	agentDir,
}) {
	const modelsPath = path.join(agentDir, "models.json");
	const config = JSON.parse(await readFile(modelsPath, "utf8"));
	config.providers.local.models.push({
		...config.providers.local.models[0],
		id: "reasoning-startup",
		reasoning: true,
	});
	await writeFile(modelsPath, JSON.stringify(config));
	let saved;
	const options = {
		extensionPath,
		cwd,
		agentDir,
		preferredModel: { provider: "local", model: "reasoning-startup" },
		signal: new AbortController().signal,
		saveModel: async (selection) => {
			saved = selection;
		},
	};
	const first = await createPiRuntime(options);
	try {
		await first.account.selectThinkingLevel("high", options.signal);
		assert.equal(saved.reasoning, "high");
	} finally {
		first.dispose();
	}
	// SDK 側の既定値と保存値を意図的に変え、`globalState` 相当の値が復元されることを確認する。
	const settingsPath = path.join(agentDir, "settings.json");
	await writeFile(
		settingsPath,
		JSON.stringify({ defaultThinkingLevel: "low" }),
	);
	const restarted = await createPiRuntime({
		...options,
		preferredModel: saved,
	});
	try {
		assert.equal(restarted.thinkingLevel, "high");
		assert.equal(
			restarted.account.snapshot().piProviderControls.effectiveReasoning,
			"high",
		);
	} finally {
		restarted.dispose();
	}
	console.log(
		"PASS: Pi startup restores saved reasoning before returning SDK session",
	);
}

/** ローカル応答の完了を期限付きで待つ。 */
async function until(check) {
	const deadline = Date.now() + 15000;
	while (!check()) {
		assert.ok(Date.now() < deadline, "Pi persistence timeout");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
