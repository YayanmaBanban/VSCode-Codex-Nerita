// 同梱SDKで保存・再開・保存先切替・移動を検証する。会話はローカルモデルだけを使う。
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdir, cp } from "node:fs/promises";
import path from "node:path";

/** 新しいControllerから同じ履歴を開き、UIとモデルの両方へ文脈を復元する。 */
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
	const create = () =>
		new PiSessionController(async (signal, authorize, resume) => ({
			cwd: workspace,
			session: await createPiRuntime({
				extensionPath,
				cwd: workspace,
				agentDir,
				storage,
				signal,
				authorize,
				resume,
				provider: "local",
				model: "smoke",
			}),
		}));
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
		const standardDirectory = path.join(
			agentDir,
			"sessions",
			(await readdir(path.join(agentDir, "sessions")))[0],
		);
		const standardFile = path.join(
			standardDirectory,
			(await readdir(standardDirectory)).find((file) =>
				file.endsWith(".jsonl"),
			),
		);
		const original = await readFile(standardFile, "utf8");
		assert.ok(original.includes("resume saved context"));
		// 設定変更だけで開いている履歴を移動せず、新規会話から切り替える。
		storage = "workspace";
		await receive({ type: "session/new" });
		const localId = controller.snapshot().sessionId;
		assert.notEqual(localId, savedId);
		assert.equal(
			await readFile(path.join(cwd, ".sessions", ".gitignore"), "utf8"),
			"*\n",
		);
		await list();
		assert.equal(controller.snapshot().sessions.length, 0);
		await send("local history");
		await list();
		assert.deepEqual(
			controller.snapshot().sessions.map((row) => row.sessionId),
			[localId],
		);
		assert.equal(await readFile(standardFile, "utf8"), original);
		await writeFile(
			path.join(cwd, ".sessions", ".gitignore"),
			"custom-*\n",
		);
		await controller.dispose();
		controller = create();
		await controller.connect();
		assert.equal(
			await readFile(path.join(cwd, ".sessions", ".gitignore"), "utf8"),
			"custom-*\n",
		);
		await list();
		await load(localId);
		assert.equal(controller.snapshot().sessionId, localId);
		await send("after restart");
		await controller.dispose();
		// フォルダーの移動はコピーで再現し、元の成果物を保持する。
		workspace = path.join(path.dirname(cwd), "relocated workspace");
		await mkdir(workspace);
		await cp(
			path.join(cwd, ".sessions"),
			path.join(workspace, ".sessions"),
			{ recursive: true },
		);
		controller = create();
		await controller.connect();
		await list();
		await load(localId);
		assert.equal(controller.snapshot().sessionId, localId);
		assert.equal(controller.snapshot().cwd, workspace);
		assert.ok(
			controller
				.snapshot()
				.messages.some((m) => m.text === "after restart"),
		);
		await send("after move");
		// 完了通知がないツールは、復元時に停止表示へ落とし承認・実行しない。
		await controller.dispose();
		const localDir = path.join(workspace, ".sessions");
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
		// 一覧取得後に空になった履歴をSDK.openで初期化しない。
		await load(localId);
		await writeFile(incomplete.getSessionFile(), "");
		await load(incomplete.getSessionId());
		assert.equal(controller.snapshot().sessionId, localId);
		assert.ok(controller.snapshot().sessionsError);
		assert.equal(await readFile(incomplete.getSessionFile(), "utf8"), "");
		await send("continue after failed restore");
		console.log(
			"PASS: Pi global/workspace persistence → ignore preservation → restart/context/tools → relocated workspace → incomplete tools → failed restore retains conversation",
		);
	} finally {
		await controller?.dispose();
	}
}

/** ローカル応答の完了を期限付きで待つ。 */
async function until(check) {
	const deadline = Date.now() + 15000;
	while (!check()) {
		assert.ok(Date.now() < deadline, "Pi persistence timeout");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
