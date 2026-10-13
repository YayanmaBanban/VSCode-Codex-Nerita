// Codex 本体を専用の保存領域で再起動し、参照メタデータの永続化と、モデルへの送信内容に参照メタデータが含まれないことを確認する。
// 実行: node tests/scratch/codex-reference-history.cjs。認証は使わず、モデル応答だけをローカルで返す。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { createInterface } = require("node:readline");
const { build } = require("esbuild");

/** JSONL の公開 RPC だけを使い、検証が終わった子プロセスを必ず終了する。 */
function connect(binary, home, cwd) {
	const child = spawn(binary, ["app-server"], {
		cwd,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			CODEX_HOME: home,
			HTTP_PROXY: "",
			HTTPS_PROXY: "",
			ALL_PROXY: "",
		},
	});
	const pending = new Map();
	const events = [];
	let sequence = 0;
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	createInterface({ input: child.stdout }).on("line", (line) => {
		const message = JSON.parse(line);
		const request = pending.get(message.id);
		if (request) {
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) {
				request.reject(new Error(JSON.stringify(message.error)));
			} else {
				request.resolve(message.result);
			}
		} else {
			events.push(message);
		}
	});
	return {
		events,
		request(method, params) {
			return new Promise((resolve, reject) => {
				const id = ++sequence;
				const timer = setTimeout(
					() => reject(new Error(`${method}: ${stderr}`)),
					30000,
				);
				pending.set(id, { resolve, reject, timer });
				child.stdin.write(
					`${JSON.stringify({ id, method, params })}\n`,
				);
			});
		},
		async close() {
			for (const request of pending.values()) {
				clearTimeout(request.timer);
			}
			pending.clear();
			if (child.exitCode !== null) {
				return;
			}
			const exited = once(child, "exit");
			child.kill();
			await exited;
		},
	};
}

/** ツールを実行する指示は返さず、`Responses API` の確定本文だけを返す。 */
async function localModel() {
	let leaked = false;
	const server = createServer(async (request, response) => {
		if (request.method === "GET") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ models: [] }));
			return;
		}
		const chunks = [];
		for await (const chunk of request) {
			chunks.push(chunk);
		}
		leaked ||= Buffer.concat(chunks)
			.toString()
			.includes("nerita.reference");
		const events = [
			{ type: "response.created", response: { id: "local-response" } },
			{
				type: "response.output_item.done",
				item: {
					type: "message",
					role: "assistant",
					id: "local-answer",
					content: [{ type: "output_text", text: "確認済み" }],
				},
			},
			{
				type: "response.completed",
				response: {
					id: "local-response",
					usage: {
						input_tokens: 1,
						output_tokens: 1,
						total_tokens: 2,
					},
				},
			},
		];
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end(
			events
				.map(
					(event) =>
						`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
				)
				.join(""),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		url: `http://127.0.0.1:${server.address().port}/v1`,
		leaked: () => leaked,
		async close() {
			server.closeAllConnections();
			server.close();
			await once(server, "close");
		},
	};
}

/** サーバー完了通知を期限付きで待ち、開始応答だけで成功と扱わない。 */
async function completed(client) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const event = client.events.find(
			(event) => event.method === "turn/completed",
		);
		if (event) {
			assert.equal(event.params.turn.status, "completed");
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Codex の完了通知がありません。");
}

/** 検証用の保存領域と製品の変換処理を準備し、利用者の設定を使わせない。 */
async function prepare() {
	const repo = path.resolve(__dirname, "../..");
	const packages = await fs.readdir(path.join(repo, "node_modules/.pnpm"));
	const platform = packages.find(
		(name) =>
			name.startsWith("@openai+codex@") && name.endsWith("-win32-x64"),
	);
	assert.ok(platform);
	const binary = path.join(
		repo,
		"node_modules/.pnpm",
		platform,
		"node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	);
	const artifacts = path.join(repo, "dist/ui-review");
	await fs.mkdir(artifacts, { recursive: true });
	const root = await fs.mkdtemp(
		path.join(artifacts, "codex-reference-history-"),
	);
	const home = path.join(root, "home");
	const cwd = path.join(root, "workspace");
	await Promise.all([fs.mkdir(home), fs.mkdir(cwd)]);
	const output = path.join(root, "codec.cjs");
	await build({
		entryPoints: [
			path.join(
				repo,
				"apps/vscode-nerita/src/extension/backends/codex/history/referenceElements.ts",
			),
		],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	return { repo, binary, root, home, cwd, codec: require(output) };
}

const text = "日本語🐈 src/素材.ts";
const references = [
	{
		offset: 6,
		path: {
			kind: "file",
			uri: "fixture:src/素材.ts",
			path: "src/素材.ts",
			name: "素材.ts",
		},
	},
];

/** 同じ保存領域を新しいプロセスで開き、本文・UTF-8 範囲・参照先を読み戻す。 */
async function verify() {
	const { repo, binary, root, home, cwd, codec } = await prepare();
	const { referenceElements, restoreReferenceElements } = codec;
	const model = await localModel();
	const input = [
		{
			type: "text",
			text,
			text_elements: referenceElements(text, references),
		},
	];
	let client;
	try {
		await fs.writeFile(
			path.join(home, "config.toml"),
			`model_provider = "local"\nmodel = "test-model"\n[model_providers.local]\nname = "Local fixture"\nbase_url = ${JSON.stringify(model.url)}\nwire_api = "responses"\nrequires_openai_auth = false\n`,
		);
		client = connect(binary, home, cwd);
		await client.request("initialize", {
			clientInfo: { name: "nerita-reference-test", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const started = await client.request("thread/start", {
			cwd,
			model: "test-model",
			modelProvider: "local",
			approvalPolicy: "never",
			sandbox: "read-only",
		});
		await client.request("turn/start", {
			threadId: started.thread.id,
			input,
		});
		await completed(client);
		await client.close();
		client = connect(binary, home, cwd);
		await client.request("initialize", {
			clientInfo: { name: "nerita-reference-test", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const { data } = await client.request("thread/items/list", {
			threadId: started.thread.id,
		});
		const user = data.find(
			(entry) => entry.item.type === "userMessage",
		).item;
		assert.deepEqual(user.content, input);
		assert.deepEqual(
			restoreReferenceElements(
				user.content[0].text,
				user.content[0].text_elements,
			),
			references,
		);
		assert.equal(model.leaked(), false);
		await fs.writeFile(
			path.join(root, "result.json"),
			JSON.stringify(
				{
					restored: true,
					modelMetadataLeaked: false,
					message: { text, references },
				},
				null,
				2,
			),
		);
		console.log(
			`Codex 本体の再起動後の参照復元: 成功 (${path.relative(repo, root)})`,
		);
	} finally {
		await client?.close();
		await model.close();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
