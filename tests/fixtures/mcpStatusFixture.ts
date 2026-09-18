// MCPコマンドの表示とページ取得に使用する、秘密情報を含まないサンプル。
import type { McpServerSummary } from "../../src/shared/mcp";
export const mcpStatusFixture = {
	name: "workspace",
	runtimeStatus: "connected",
	pluginId: null,
	serverInfo: null,
	tools: {
		search: {
			name: "search",
			description: "ワークスペース内を検索",
			inputSchema: { type: "object", properties: {} },
		},
	},
	toolsError: null,
	resources: [],
	resourceTemplates: [],
	authStatus: "notLoggedIn",
};

/** 接続済み・無効・不明と、折り返しが必要な長い名前を確認する。 */
export const mcpServersFixture: McpServerSummary[] = [
	{ name: "workspace", runtimeStatus: "connected" },
	{ name: "mcptool_1", runtimeStatus: "disabled" },
	{
		name: "workspace_tools_with_a_very_long_server_name_for_wrapping",
		runtimeStatus: null,
	},
];
