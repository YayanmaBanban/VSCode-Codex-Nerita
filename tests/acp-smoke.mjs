// 実際の adapter で初期化・会話・応答・終了を検証する手動スモークテスト。
// 認証情報・プロンプト全文・診断ログは出力しない。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import {
	client,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

const require = createRequire(import.meta.url);
const adapter =
	process.env.ACP_SMOKE_ADAPTER ||
	require.resolve("@agentclientprotocol/codex-acp");
const child = spawn(process.execPath, [adapter], {
	cwd: process.cwd(),
	windowsHide: true,
	env: {
		...process.env,
		INITIAL_AGENT_MODE: "read-only",
		APP_SERVER_LOGS: "",
	},
	stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.resume();
let text = "";
const connection = client()
	.onNotification("session/update", ({ params }) => {
		if (
			params.update.sessionUpdate === "agent_message_chunk" &&
			params.update.content.type === "text"
		) {
			text += params.update.content.text;
		}
	})
	.onRequest("session/request_permission", () => ({
		outcome: { outcome: "cancelled" },
	}))
	.connect(
		ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
	);
const timer = setTimeout(
	() => connection.close(new Error("Smoke timeout")),
	90_000,
);
try {
	const initialized = await connection.agent.request("initialize", {
		protocolVersion: PROTOCOL_VERSION,
		clientCapabilities: {},
		clientInfo: { name: "codex-acp-smoke", version: "0.0.1" },
	});
	console.log(
		JSON.stringify({
			protocolVersion: initialized.protocolVersion,
			authMethods: initialized.authMethods?.map(({ id }) => id),
		}),
	);
	const session = await connection.agent.request("session/new", {
		cwd: process.cwd(),
		mcpServers: [],
	});
	console.log("Session created");
	const result = await connection.agent.request("session/prompt", {
		sessionId: session.sessionId,
		prompt: [
			{
				type: "text",
				text: "Reply with exactly ACP_OK. Do not use tools or modify files.",
			},
		],
	});
	console.log(
		JSON.stringify({
			stopReason: result.stopReason,
			receivedReply: text.includes("ACP_OK"),
		}),
	);
	if (!text.includes("ACP_OK")) {
		process.exitCode = 1;
	}
} catch (error) {
	console.error(
		JSON.stringify({ name: error?.name, code: error?.code, failed: true }),
	);
	process.exitCode = 1;
} finally {
	clearTimeout(timer);
	child.stdin.end();
	connection.close();
	const killTimer = setTimeout(() => {
		if (child.exitCode === null && child.pid) {
			if (process.platform === "win32") {
				spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
					windowsHide: true,
					stdio: "ignore",
				});
			} else {
				child.kill();
			}
		}
	}, 4000);
	child.once("exit", () => {
		clearTimeout(killTimer);
		console.log("Adapter exited");
	});
}
