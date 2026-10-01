// 配布アダプターの内部 API を、この境界で必要な操作だけに限定する。
import type {
	McpServerConfig,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** SDK の接続が保持する情報を Host の登録・取消処理へ渡す。 */
export type PiMcpConnection = {
	state: string;
	tools: {
		name: string;
		description?: string;
		inputSchema: ToolDefinition["parameters"];
		outputSchema?: Record<string, unknown>;
	}[];
	hasResources: boolean;
	getClient(): Promise<unknown>;
	callTool(
		name: string,
		args: Record<string, unknown>,
		options: { signal: AbortSignal; timeoutMs: number },
	): Promise<unknown>;
	readResource(
		uri: string,
		options: { signal: AbortSignal; timeoutMs: number },
	): Promise<unknown>;
	resourcesPage(
		cursor: string | undefined,
		options: { signal: AbortSignal; timeoutMs: number },
	): Promise<unknown>;
	resourceTemplatesPage(
		cursor: string | undefined,
		options: { signal: AbortSignal; timeoutMs: number },
	): Promise<unknown>;
	close(): Promise<void>;
};

/** 上流の内部型をアプリケーション全体へ広げず、配布入口の契約を固定する。 */
export type PiMcpSdk = {
	validateMcpServerConfig(
		name: string,
		value: unknown,
	): McpServerConfig | string;
	getMcpToolExposure(config: McpServerConfig, name: string): string;
	createMcpToolName(
		server: string,
		name: string,
		taken?: (name: string) => boolean,
	): string;
	toToolExposure(exposure: string): NonNullable<ToolDefinition["exposure"]>;
	FileAuthStorageBackend: new (path: string) => unknown;
	McpOAuthCredentialStore: new (backend: unknown, lockDir: string) => unknown;
	StreamableHttpTransport: new (options: {
		url: string;
		headers: Record<string, string>;
		authProvider: unknown;
		fetch: typeof fetch;
		maxMessageBytes: number;
	}) => unknown;
	McpServerConnection: new (options: {
		entry: {
			name: string;
			source: string;
			scope: string;
			config: McpServerConfig;
		};
		cwd: string;
		credentials: unknown;
		oauthFetch: typeof fetch;
		createTransport: (
			entry: unknown,
			cwd: string,
			auth: unknown,
		) => unknown;
		onTools: (connection: PiMcpConnection) => void;
	}) => PiMcpConnection;
};
