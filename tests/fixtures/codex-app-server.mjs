// JSONL の順序・サーバー要求・異常終了を再現する App Server のテスト用プロセス。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.argv[2];
let initialized = false;
let initializeId;
const approvals = new Set();
/** 通知と応答を JSONL の一行として送る。 */
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
/** 初期化応答を UTF-8 の文字途中で分割し、チャンク境界への依存を検出する。 */
function finishInitialize() {
	const bytes = Buffer.from(
		`${JSON.stringify({
			id: initializeId,
			result: {
				userAgent: "Codex 日本語",
				codexHome: "fixture",
				platformFamily: "windows",
				platformOs: "windows",
			},
		})}\n`,
	);
	const cut = bytes.indexOf(Buffer.from("日")) + 1;
	process.stdout.write(bytes.subarray(0, cut));
	setTimeout(() => process.stdout.write(bytes.subarray(cut)), 10);
}
if (mode === "tree") {
	const descendant = spawn(
		process.execPath,
		["-e", "setInterval(() => {}, 1000)"],
		{ windowsHide: true, stdio: "ignore" },
	);
	writeFileSync("pids.json", JSON.stringify([process.pid, descendant.pid]));
}
createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	assert.equal("jsonrpc" in message, false);
	if (message.method === "initialize") {
		initializeId = message.id;
		assert.equal(message.params.capabilities.experimentalApi, false);
		assert.equal(message.params.capabilities.requestAttestation, false);
		if (mode === "serverRequests") {
			// クライアント要求と同じ数値 ID、および文字列 ID への応答を検証する。
			for (const id of [initializeId, "approval-a"]) {
				approvals.add(id);
				send({
					id,
					method: "item/commandExecution/requestApproval",
					params: {},
				});
			}
		} else {
			finishInitialize();
		}
	} else if ("error" in message) {
		assert.equal(message.error.code, -32601);
		assert.ok(approvals.delete(message.id));
		if (!approvals.size) {
			finishInitialize();
		}
	} else if (message.method === "initialized") {
		initialized = true;
		send({ method: "fixture/ready", params: { text: "準備完了" } });
	} else if (message.method === "thread/loaded/list") {
		if (!initialized) {
			send({
				id: message.id,
				error: { code: -32002, message: "Not initialized" },
			});
			return;
		}
		if (mode === "timeout" || mode === "tree") {
			return;
		}
		if (mode === "disconnect") {
			process.exit(0);
		}
		if (mode === "malformed") {
			process.stdout.write("not JSON\n");
			return;
		}
		if (mode === "rpcError") {
			send({
				id: message.id,
				error: {
					code: -32602,
					message: "Invalid cursor",
					data: { field: "cursor" },
				},
			});
			return;
		}
		if (mode === "wrongResult") {
			send({ id: message.id, result: { data: [42], nextCursor: null } });
			return;
		}
		const cursor = message.params.cursor ?? "first";
		setTimeout(
			() =>
				send({
					id: message.id,
					result: { data: [cursor], nextCursor: null },
				}),
			cursor === "slow" ? 50 : 0,
		);
	}
});
