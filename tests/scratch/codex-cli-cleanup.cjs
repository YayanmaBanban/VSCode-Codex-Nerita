// 今回の CLI が作成した会話 ID と Worktree を照合し、指定した対象だけを回収する。
// 一覧検索から削除対象を選ばず、記録した ID・実行先・Git 管理先・検証用本文を確認する。
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createInterface } = require("node:readline");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const execute = promisify(execFile);

async function cleanup(binary, cwd, managedRoot, record) {
	assert.match(record.sourceLeaf, /^nerita-codex-cli-[a-z\d]+$/i);
	assert.ok(record.targets.length > 0);
	assert.equal(
		new Set(record.targets.map((target) => target.threadId)).size,
		record.targets.length,
	);
	const client = startCleanupServer(binary, cwd);
	const request = client.request;
	let removed = 0;
	try {
		await request("initialize", {
			clientInfo: {
				name: "nerita_probe_cleanup",
				title: null,
				version: "1",
			},
			capabilities: { experimentalApi: true },
		});
		client.notify("initialized");
		for (const target of record.targets) {
			assert.match(target.threadId, /^[a-f\d-]{36}$/i);
			assert.match(target.cwdRelative, /^[a-f\d]{4}[\\/]main$/i);
			const checkout = path.resolve(managedRoot, target.cwdRelative);
			await verifyCheckout(checkout, managedRoot, record.sourceLeaf);
			const response = await request("thread/read", {
				threadId: target.threadId,
				includeTurns: false,
			});
			assert.equal(response.thread.id, target.threadId);
			assert.equal(response.thread.modelProvider, "nerita_probe");
			assert.equal(
				(await fs.realpath(response.thread.cwd)).toLowerCase(),
				checkout.toLowerCase(),
			);
			assert.equal(
				response.thread.preview,
				"Run the fixed probe once and report completion.",
			);
			await request("thread/archive", { threadId: target.threadId });
			await request("thread/delete", { threadId: target.threadId });
			await fs.rm(checkout, { recursive: true, force: true });
			const bucket = path.dirname(checkout);
			if ((await fs.readdir(bucket)).length === 0) {
				await fs.rmdir(bucket);
			}
			removed++;
		}
		return removed;
	} finally {
		await client.dispose();
	}
}

/** 終了待ちと保留要求を管理し、回収用の専用プロセスを確実に止める。 */
function startCleanupServer(binary, cwd) {
	const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
		cwd,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stderr.resume();
	const pending = new Map();
	let sequence = 0;
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		const message = JSON.parse(line);
		const waiting = pending.get(message.id);
		if (!waiting) {
			return;
		}
		pending.delete(message.id);
		if (message.error) {
			waiting.reject(new Error(message.error.message));
		} else {
			waiting.resolve(message.result);
		}
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	const timer = setTimeout(() => child.kill(), 30000);
	child.on("error", (error) => {
		for (const waiting of pending.values()) {
			waiting.reject(error);
		}
	});
	child.on("exit", () => {
		for (const waiting of pending.values()) {
			waiting.reject(new Error("回収用 App Server が終了しました。"));
		}
	});
	return {
		request,
		notify: (method) =>
			child.stdin.write(`${JSON.stringify({ method })}\n`),
		dispose: async () => {
			clearTimeout(timer);
			lines.close();
			await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
			});
		},
	};
}

async function verifyCheckout(checkout, managedRoot, sourceLeaf) {
	assert.ok(path.isAbsolute(managedRoot));
	assert.match(
		path.relative(managedRoot, checkout),
		/^[a-f\d]{4}[\\/]main$/i,
	);
	for (const directory of [managedRoot, path.dirname(checkout), checkout]) {
		const stat = await fs.lstat(directory);
		assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
	}
	const gitFile = path.join(checkout, ".git");
	assert.ok((await fs.lstat(gitFile)).isFile());
	const linked = (await fs.readFile(gitFile, "utf8")).trim();
	assert.ok(linked.startsWith("gitdir: "));
	const sourceGit = path.join(os.tmpdir(), sourceLeaf, "main/.git/worktrees");
	assert.match(
		path.relative(sourceGit, linked.slice("gitdir: ".length)),
		/^[^\\/]+$/,
	);
	for (const entry of await fs.readdir(checkout)) {
		assert.ok(
			[".git", "probe.cjs", "cache"].includes(entry),
			"検証領域に予定外のファイルがあります。",
		);
	}
	const probe = await fs.readFile(path.join(checkout, "probe.cjs"), "utf8");
	assert.ok(
		probe.includes("console.log('CLI_PROBE='") &&
			probe.includes("Buffer.alloc(64 * 1024, 17)"),
	);
}

module.exports = { cleanup };
