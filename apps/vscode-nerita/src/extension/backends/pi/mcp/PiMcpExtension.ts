// 管理ビューと独立して、明示的に有効化した HTTP MCP を使い、Host の中断時に接続を閉じる。

import { watchFile, unwatchFile } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { loadPiMcpConfig, type PiMcpEntry } from "./PiMcpConfig";
import type { PiMcpSdk } from "./PiMcpSdk";
import { PiMcpServer } from "./PiMcpServer";
import { mcpIdentity } from "./PiMcpGate";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";
import type { PiAuthorize } from "../PiApprovedTools";
import type { PiToolFeatures } from "../PiToolFeatures";
import { SecretAuthBackend } from "../../../credentials/SecretAuthBackend";
import {
	SessionMemoryCredentialStore,
	SecretRedactor,
} from "../../../credentials/CredentialStore";

/** 設定の有効化、認証、接続を自動実行する拡張コードから分離する。 */
export function neritaMcpExtension(options: McpOptions): ExtensionFactory {
	return (pi) => {
		const servers = new Map<string, PiMcpServer>();
		const connection: {
			sdk: PiMcpSdk | undefined;
			credentials: unknown;
			backend: SecretAuthBackend | undefined;
			queue: Promise<void>;
		} = {
			sdk: undefined,
			credentials: undefined,
			backend: undefined,
			queue: Promise.resolve(),
		};
		const paths = [
			join(options.agentDir, "mcp.json"),
			join(options.cwd, ".pi/mcp.json"),
		];
		/** 信頼済みとしてロードした拡張の登録だけを設定の候補に含める。 */
		const config = createMcpConfigLoader(options, pi, connection);
		/** 変更を検出した時点で古い接続を失効させ、承認待ちも取り消す。 */
		const invalidate = () => {
			for (const server of servers.values()) {
				void server.close().catch(() => undefined);
			}
			servers.clear();
		};
		/** 設定と登録がない会話では、MCP の配布資産を読み込まない。 */
		const ensureSdk = createMcpSdkLoader(connection, paths, pi, options);
		/** 終了済み、設定が変更された、または削除されたサーバーの接続を閉じる。 */
		const removeObsolete = async (
			entries: Awaited<ReturnType<typeof config>>["entries"],
		) => {
			for (const [name, server] of servers) {
				const entry = entries.find((item) => item.name === name);
				if (
					!entry ||
					!server.active ||
					mcpIdentity(entry) !== server.identity
				) {
					await server.close();
					servers.delete(name);
				}
			}
		};

		/** 子に公開できる MCP ツールがないサーバーには接続しない。 */
		const serverPermitted = (name: string): boolean => {
			const allowed = options.features.allowedTools;
			if (!allowed) {
				return true;
			}
			const prefix = connection.sdk!.createMcpToolName(name, "");
			return allowed.some((tool) => tool.startsWith(prefix));
		};
		/** 遅い旧接続が新しい設定の後から登録する競合を避ける。 */
		const synchronize = createMcpSynchronizer(
			connection,
			options,
			ensureSdk,
			config,
			serverPermitted,
			removeObsolete,
			servers,
			pi,
		);
		/** 設定の追加・変更は再接続対象とし、通信には新しい承認を必要とする。 */
		const changed = () => {
			invalidate();
		};
		bindMcpLifetime(
			pi,
			paths,
			changed,
			invalidate,
			synchronize,
			servers,
			options,
		);
	};
}

/** セッション終了時や中断時に設定監視を解除し、サーバー接続を閉じる。 */
function bindMcpLifetime(
	pi: ExtensionAPI,
	paths: string[],
	changed: () => void,
	invalidate: () => void,
	synchronize: () => Promise<void>,
	servers: Map<string, PiMcpServer>,
	options: McpOptions,
) {
	pi.on("session_start", () => {
		for (const path of paths) {
			watchFile(path, { persistent: false, interval: 500 }, changed);
		}
	});
	pi.on("mcp_servers_change", async (_event, context) => {
		invalidate();
		if (!context.isIdle()) {
			await synchronize();
		}
	});
	pi.on("before_agent_start", async () => {
		await synchronize();
	});
	pi.on("session_shutdown", async () => {
		for (const path of paths) {
			unwatchFile(path, changed);
		}
		const pending = [...servers.values()].map((server) => server.close());
		servers.clear();
		await Promise.all(pending);
	});
	const aborted = () => {
		for (const path of paths) {
			unwatchFile(path, changed);
		}
		invalidate();
	};
	options.signal.addEventListener("abort", aborted, { once: true });
}

/** 設定変更と接続処理を直列化し、遅れた旧接続の登録を防ぐ。 */
function createMcpSynchronizer(
	connection: {
		sdk: PiMcpSdk | undefined;
		credentials: unknown;
		backend: SecretAuthBackend | undefined;
		queue: Promise<void>;
	},
	options: McpOptions,
	ensureSdk: () => Promise<boolean>,
	config: () => Promise<{ entries: PiMcpEntry[]; errors: string[] }>,
	serverPermitted: (name: string) => boolean,
	removeObsolete: (entries: PiMcpEntry[]) => Promise<void>,
	servers: Map<string, PiMcpServer>,
	pi: ExtensionAPI,
) {
	return () => {
		connection.queue = connection.queue
			.catch(() => undefined)
			.then(async () => {
				if (options.signal.aborted || !(await ensureSdk())) {
					return;
				}
				const loaded = await config();
				const entries = loaded.entries.filter(
					(entry) =>
						(entry.config?.enabled === true &&
							"url" in entry.config &&
							options.policy.networkAccess &&
							serverPermitted(entry.name)) === true,
				);
				await removeObsolete(entries);
				for (const entry of entries) {
					options.signal.throwIfAborted();
					if (servers.has(entry.name)) {
						continue;
					}
					try {
						const backend = (connection.backend ??= options.features
							.mcpBackend
							? await options.features.mcpBackend()
							: await SecretAuthBackend.create(
									new SessionMemoryCredentialStore(),
									new SecretRedactor(),
								));
						connection.credentials ??= lockedMcpCredentials(
							connection.sdk!,
							backend,
						);
						const server = new PiMcpServer({
							...options,
							entry,
							sdk: connection.sdk!,
							pi,
							credentials: connection.credentials,
							flushCredentials: () => backend.flush(),
							current: async () =>
								(await config()).entries.find(
									(item) => item.name === entry.name,
								),
						});
						servers.set(entry.name, server);
						await server.connect();
					} catch {
						// 生の HTTP エラーには認証値が含まれ得るため、SDK のエラー通知へ渡さない。
						const server = servers.get(entry.name);
						await server?.close();
						servers.delete(entry.name);
					}
				}
			});
		return connection.queue;
	};
}

/** 信頼した拡張の登録だけを設定の候補に含める。 */
function createMcpConfigLoader(
	options: McpOptions,
	pi: ExtensionAPI,
	connection: {
		sdk: PiMcpSdk | undefined;
		credentials: unknown;
		backend: SecretAuthBackend | undefined;
		queue: Promise<void>;
	},
) {
	return () =>
		loadPiMcpConfig(
			{
				...options,
				projectTrusted: options.projectTrusted(),
				extensions: pi
					.getMcpServers()
					.filter((item) =>
						options.trustedExtensionPaths.includes(
							item.extensionPath,
						),
					),
			},
			(name, value) =>
				connection.sdk!.validateMcpServerConfig(name, value),
		);
}

/** 設定と登録がない会話では MCP の配布資産を読み込まない。 */
function createMcpSdkLoader(
	connection: {
		sdk: PiMcpSdk | undefined;
		credentials: unknown;
		backend: SecretAuthBackend | undefined;
		queue: Promise<void>;
	},
	paths: string[],
	pi: ExtensionAPI,
	options: McpOptions,
) {
	return async () => {
		if (connection.sdk) {
			return true;
		}
		const exists = await Promise.all(
			paths.map((path) =>
				access(path).then(
					() => true,
					() => false,
				),
			),
		);
		if (!exists.some(Boolean) && pi.getMcpServers().length === 0) {
			return false;
		}
		connection.sdk = await options.load();
		return true;
	};
}

/** MCP 接続に固定する設定と実行権限。 */
type McpOptions = {
	load: () => Promise<PiMcpSdk>;
	cwd: string;
	agentDir: string;
	projectTrusted: () => boolean;
	trustedExtensionPaths: string[];
	policy: AgentAccessPolicy;
	authorize: PiAuthorize;
	signal: AbortSignal;
	features: PiToolFeatures;
};
/** ファイルロックを作らず、Host 共通バックエンドで認証更新を直列化する。 */
function lockedMcpCredentials(sdk: PiMcpSdk, backend: SecretAuthBackend) {
	const credentials = new sdk.McpOAuthCredentialStore(backend);
	return {
		forServer: (name: string, url: string) => {
			const server = credentials.forServer(name, url);
			return {
				...server,
				withRefreshLock: <T>(operation: () => Promise<T>) =>
					backend.withRefreshLock(
						JSON.stringify([name, url]),
						operation,
					),
			};
		},
	};
}
