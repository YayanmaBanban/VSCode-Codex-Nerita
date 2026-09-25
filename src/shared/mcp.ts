// MCP 一覧の表示用データと、Host・Webview 共通の検証を定義する。
import { isRecord } from "./validation";

/** MCP サーバーの表示に必要な名前と接続状態。 */
export type McpServerSummary = { name: string; runtimeStatus: string | null };

/** 1つの MCP メッセージの取得状態。 */
export type McpMessageContent =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; servers: McpServerSummary[] };

/** 未知の接続状態も文字列として受け付け、UI では中立色で表示する。 */
export function isMcpServerSummary(value: unknown): value is McpServerSummary {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		(value.runtimeStatus === null ||
			typeof value.runtimeStatus === "string")
	);
}

/** 未検証の一覧を Webview の描画へ渡さない。 */
export function isMcpMessageContent(
	value: unknown,
): value is McpMessageContent {
	return (
		isRecord(value) &&
		(value.status === "loading" ||
			value.status === "error" ||
			(value.status === "ready" &&
				Array.isArray(value.servers) &&
				value.servers.every(isMcpServerSummary)))
	);
}

/** コピー時も名前と接続状態を読み取れる本文にする。 */
export function mcpSummaryText(servers: McpServerSummary[]): string {
	const list = servers.length
		? servers
				.map(
					(server) =>
						`● ${server.name} (${server.runtimeStatus ?? "不明"})`,
				)
				.join("\n")
		: "利用可能なMCPサーバーはありません。";
	return servers.length ? `設定済みMCPサーバー:\n${list}` : list;
}
