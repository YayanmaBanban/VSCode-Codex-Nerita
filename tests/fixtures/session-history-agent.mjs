// セッション管理の実 RPC と履歴通知の順序を検証する最小 ACP サーバー。
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import path from "node:path";
let sequence = 0;
let sessions = [
	{
		sessionId: "saved",
		cwd: process.cwd(),
		title: "保存した会話",
		updatedAt: "2026-09-15T12:00:00Z",
	},
];
/** JSON-RPC の一行を標準出力へ送る。 */
const send = (value) =>
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	const { method, params, id } = request;
	if (id === undefined) {
		return;
	}
	appendFileSync(
		path.join(process.cwd(), "requests.jsonl"),
		`${JSON.stringify(request)}\n`,
	);
	let result = {};
	if (method === "initialize") {
		result = {
			protocolVersion: 1,
			agentCapabilities: {
				loadSession: true,
				sessionCapabilities: { list: {}, fork: {}, delete: {} },
			},
		};
	} else if (method === "session/new" || method === "session/fork") {
		const sessionId = `created-${++sequence}`;
		sessions.push({ sessionId, cwd: params.cwd, title: "新規セッション" });
		result = { sessionId };
	} else if (method === "session/list") {
		// 空ページに次のカーソルがある場合も取得を続ける必要がある。
		result = params.cursor
			? { sessions }
			: { sessions: [], nextCursor: "second" };
	} else if (method === "session/load") {
		for (const [sessionUpdate, text] of [
			["user_message_chunk", "以前の質問"],
			["agent_message_chunk", "以前の回答"],
		]) {
			send({
				method: "session/update",
				params: {
					sessionId: params.sessionId,
					update: { sessionUpdate, content: { type: "text", text } },
				},
			});
		}
	} else if (method === "session/delete") {
		sessions = sessions.filter(
			(session) => session.sessionId !== params.sessionId,
		);
	} else if (method === "session/prompt") {
		result = { stopReason: "end_turn" };
	} else {
		send({ id, error: { code: -32601, message: "Unknown method" } });
		return;
	}
	send({ id, result });
});
