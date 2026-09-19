// MCP一覧の応答から名前と接続状態を検証・抽出し、全ページを取得する。
import { isRecord } from "../../shared/validation";
import { isMcpServerSummary, type McpServerSummary } from "../../shared/mcp";
import type { CodexConnection } from "./runtime/connection";

/** 表示に必要な項目だけを抽出し、ツール定義や認証情報をUIへ渡さない。 */
export function parseMcpStatus(value: unknown): {
	data: McpServerSummary[];
	nextCursor: string | null;
} {
	if (
		!isRecord(value) ||
		!Array.isArray(value.data) ||
		!value.data.every(isMcpServerSummary) ||
		!(value.nextCursor === null || typeof value.nextCursor === "string")
	) {
		throw new Error("MCPサーバー一覧の応答が不正です。");
	}
	return {
		data: value.data.map(({ name, runtimeStatus }) => ({
			name,
			runtimeStatus,
		})),
		nextCursor: value.nextCursor,
	};
}

/** 接続・会話の有効性をページごとに確認して、一覧を欠けなく取得する。 */
export async function listMcpServers(
	client: CodexConnection,
	threadId: string,
	checkCurrent: () => void,
): Promise<McpServerSummary[]> {
	const data: McpServerSummary[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	do {
		checkCurrent();
		const page = await client.listMcpServerStatus(threadId, cursor);
		checkCurrent();
		data.push(...page.data);
		if (page.nextCursor === null) {
			break;
		}
		if (cursors.has(page.nextCursor)) {
			throw new Error("MCPサーバー一覧のページが循環しています。");
		}
		cursor = page.nextCursor;
		cursors.add(cursor);
	} while (cursor !== undefined);
	return data;
}
