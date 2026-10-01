// Host が利用する API だけを専用の ESM モジュールから公開する。
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
export {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	DefaultResourceLoader,
	DefaultPackageManager,
	getAgentDir,
	getPackageDir,
	convertToPng,
	resizeImage,
	parseSessionEntries,
	convertToLlm,
	serializeConversation,
	parseFrontmatter,
	createWriteToolDefinition,
	createReadToolDefinition,
	createLsToolDefinition,
	createEditToolDefinition,
	createPowerShellToolDefinition,
	createBashToolDefinition,
	createCodemodeExtension,
} from "@earendil-works/pi-coding-agent";

export { createToolSearchExtension } from "@nerita/pi-tool-search";

/** MCP の内部 API は専用アダプターに限定し、接続が必要な時だけ読み込む。 */
export const loadPiMcp = () => import("./pi-mcp-entry.mjs");
