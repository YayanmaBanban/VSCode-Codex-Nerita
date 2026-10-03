// Worker を起動し、子プロセスの標準出力を使って JSONL の順序・UTF-8・最終応答・切断を検証する。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AppServerJsonReader } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/AppServerJsonReader";
import { AppServerTransport } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/AppServerTransport";

void test("JSONL の文字途中と複数行を跨いでも、Worker が受信順に復元する", async (t) => {
	const expected = ['日本語🐈\\"\n'.repeat(500000), "続き", "改行なし"];
	const bytes = Buffer.from(
		expected.map((value) => JSON.stringify({ value })).join("\r\n"),
	);
	const values: unknown[] = [];
	let finish!: () => void;
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	// 最初の日本語の途中で分割し、以降は一行より小さい任意長で渡す。
	const chunks = [bytes.subarray(0, 12)];
	for (let offset = 12; offset < bytes.length; offset += 65531) {
		chunks.push(bytes.subarray(offset, offset + 65531));
	}
	const reader = new AppServerJsonReader(
		Readable.from(chunks, { objectMode: false }),
		(value) => values.push(value),
		finish,
	);
	t.after(() => reader.dispose());
	await done;
	assert.deepEqual(
		values,
		expected.map((value) => ({ value })),
	);
});

void test("JSONL の不正行と不正UTF-8を拒否し、後続の通知を公開しない", async (t) => {
	for (const broken of [
		Buffer.from('{"secret":bad}\n'),
		Buffer.from([0x22, 0xff, 0x22, 0x0a]),
	]) {
		const values: unknown[] = [];
		let finish!: (error: Error) => void;
		const done = new Promise<Error>((resolve) => {
			finish = resolve;
		});
		const input = Readable.from([
			Buffer.concat([
				Buffer.from('{"ok":1}\n'),
				broken,
				Buffer.from('{"late":2}\n'),
			]),
		]);
		const reader = new AppServerJsonReader(
			input,
			(value) => values.push(value),
			finish,
		);
		t.after(() => reader.dispose());
		const error = await done;
		assert.deepEqual(values, [{ ok: 1 }]);
		assert.ok(!error.message.includes("secret"));
	}
});

void test("巨大通知が続いても先読みを制限し、配信中の破棄で後続を止める", async (t) => {
	let produced = 0;
	let received = 0;
	let finish!: () => void;
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const line = Buffer.from(
		`${JSON.stringify({ output: "x".repeat(1024 * 1024) })}\n`,
	);
	/** 消費要求が来た分だけ同じ外部応答を生成し、全件の先読みを検出する。 */
	function* source() {
		for (let i = 0; i < 100; i++) {
			produced++;
			yield line;
		}
	}
	const reader = new AppServerJsonReader(
		Readable.from(source(), { objectMode: false }),
		() => {
			received++;
			void reader.dispose().then(finish);
		},
		() => assert.fail("意図した破棄を接続エラーにしない"),
	);
	t.after(() => reader.dispose());
	await done;
	assert.equal(received, 1);
	assert.ok(produced < 100);
});

void test("終了直前の巨大通知と改行なしの最終RPC応答を取りこぼさない", async (t) => {
	const child = spawn(
		process.execPath,
		[
			"-e",
			`
require('node:readline').createInterface({input:process.stdin}).once('line', line => {
 const { id } = JSON.parse(line);
 const large = JSON.stringify({method:'large',params:'日本語🐈'.repeat(1000000)});
 process.stdout.end(large + '\\n' + JSON.stringify({id,result:{account:null,requiresOpenaiAuth:true}}));
 process.stdin.destroy();
});`,
		],
		{ windowsHide: true, stdio: "pipe" },
	);
	const order: string[] = [];
	const transport = new AppServerTransport(child, {
		notification: ({ method, params }) => {
			order.push(method);
			assert.ok(typeof params === "string");
			assert.equal(params.length, 5000000);
			assert.ok(params.endsWith("日本語🐈"));
		},
		disconnected: () => order.push("disconnected"),
	});
	t.after(() => transport.dispose());
	const response = await transport.request("account/read", {
		refreshToken: false,
	});
	assert.equal(response.authenticated, false);
	assert.equal(order[0], "large");
	assert.ok(
		!order.includes("disconnected") || order.indexOf("disconnected") > 0,
	);
});

void test("受信中の接続破棄でRPCを拒否し、Worker の遅い結果を配信しない", async (t) => {
	const child = spawn(
		process.execPath,
		[
			"-e",
			`
process.stdin.once('data', () => {
 process.stdout.write('{"method":"large","params":"' + 'x'.repeat(16000000));
 setInterval(() => {}, 1000);
});`,
		],
		{ windowsHide: true, stdio: "pipe" },
	);
	let notifications = 0;
	const transport = new AppServerTransport(child, {
		notification: () => {
			notifications++;
		},
	});
	t.after(() => transport.dispose());
	const rejected = assert.rejects(
		transport.request("account/read", { refreshToken: false }),
	);
	await new Promise<void>((resolve) =>
		child.stdout.once("readable", resolve),
	);
	await transport.dispose();
	await rejected;
	assert.equal(notifications, 0);
	assert.ok(child.stdout.destroyed);
});
