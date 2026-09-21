// 隔離ワークスペースで実モデルの添付・設定・コマンド・編集通知を検証する。
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve("dist", "codex phase2 smoke", randomUUID());
await mkdir(root, { recursive: true });
const attachment = path.join(root, "input.txt");
await writeFile(
	attachment,
	"The output file must contain PHASE2_FILE_OK and a newline.\n",
);
const bundle = path.join(root, "client.mjs");
await build({
	stdin: {
		contents:
			'export { CodexClient } from "./src/extension/backends/codex/CodexClient"; export { CodexSessionController } from "./src/extension/backends/codex/CodexSessionController";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: bundle,
});
const { CodexClient, CodexSessionController } = await import(
	pathToFileURL(bundle).href
);
const events = new Set();
const session = new CodexSessionController(
	async (callbacks, signal) => {
		const client = await CodexClient.connect({
			extensionPath: process.cwd(),
			cwd: root,
			signal,
			clientInfo: {
				name: "vscode_codex_phase2_smoke",
				title: "Phase 2 smoke",
				version: "0.0.1",
			},
			callbacks: {
				...callbacks,
				notification(message) {
					events.add(message.method);
					callbacks.notification?.(message);
				},
			},
		});
		return {
			cwd: root,
			client: {
				readAccount: () => client.readAccount(),
				listThreads: (...args) => client.listThreads(...args),
				readThread: (...args) => client.readThread(...args),
				resumeThread: (...args) => client.resumeThread(...args),
				forkThread: (...args) => client.forkThread(...args),
				listTurns: (...args) => client.listTurns(...args),
				listItems: (...args) => client.listItems(...args),
				renameThread: (...args) => client.renameThread(...args),
				archiveThread: (...args) => client.archiveThread(...args),
				unarchiveThread: (...args) => client.unarchiveThread(...args),
				listModels: (cursor) => client.listModels(cursor),
				readRateLimits: () => client.readRateLimits(),
				login: (params) => client.login(params),
				cancelLogin: (id) => client.cancelLogin(id),
				dispose: () => client.dispose(),
				startThread: (params) =>
					client.startThread({
						...params,
						sandbox: "workspace-write",
						approvalPolicy: "never",
					}),
				startTurn: (params) => client.startTurn(params),
				interruptTurn: (thread, turn) =>
					client.interruptTurn(thread, turn),
			},
		};
	},
	{
		pick: async () => [
			{
				id: "input",
				name: "input.txt",
				uri: pathToFileURL(attachment).href,
			},
		],
		open: async () => undefined,
	},
);
/** 現在の会話にUIと同じ操作を送る。 */
const send = (message) =>
	session.receive({
		requestId: randomUUID(),
		sessionId: session.snapshot().sessionId,
		...message,
	});
let timer;
try {
	await session.connect();
	assert.equal(session.snapshot().connection, "ready");
	const model = session
		.snapshot()
		.configOptions.find((item) => item.id === "model");
	assert.ok(model.options.length > 0, "model catalog loaded");
	await send({
		type: "config/set",
		configId: "model",
		value: model.currentValue,
	});
	await send({ type: "attachment/add" });
	assert.equal(session.snapshot().attachments.length, 1);
	await send({
		type: "prompt/send",
		text: "Use apply_patch to create phase2-output.txt in the current workspace. Follow the attached input.txt for its exact contents. Then run a shell command to read that file and print TERMINAL_PHASE2_OK. Do not access the network or change any other files. Finally reply PHASE2_SMOKE_OK.",
	});
	await new Promise((resolve, reject) => {
		const check = () => {
			if (!["running", "cancelling"].includes(session.snapshot().run)) {
				clearTimeout(timer);
				unsubscribe();
				resolve();
			}
		};
		const unsubscribe = session.subscribe(check);
		timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("Model turn timeout"));
		}, 120000);
		check();
	});
	const state = session.snapshot();
	await writeFile(
		path.join(root, "result.json"),
		JSON.stringify({ state, events: [...events] }, null, 2),
	);
	assert.equal(state.run, "completed", state.error ?? undefined);
	assert.equal(
		(await readFile(path.join(root, "phase2-output.txt"), "utf8")).trim(),
		"PHASE2_FILE_OK",
	);
	assert.ok(
		events.has("item/commandExecution/outputDelta"),
		"terminal streamed",
	);
	assert.ok(
		state.tools.some(
			(tool) =>
				tool.kind === "edit" &&
				tool.content?.some((item) => item.type === "unifiedDiff"),
		),
		"file diff mapped",
	);
	assert.ok(
		state.tools.some(
			(tool) =>
				tool.kind === "execute" &&
				JSON.stringify(tool.rawOutput).includes("TERMINAL_PHASE2_OK"),
		),
		"terminal output mapped",
	);
	assert.ok(state.usage, "context usage received");
	assert.equal(state.attachments.length, 0);
	console.log(
		`Phase 2: model settings, attachment, file diff, terminal streaming and usage verified. ${root}`,
	);
} finally {
	clearTimeout(timer);
	await session.dispose();
}
