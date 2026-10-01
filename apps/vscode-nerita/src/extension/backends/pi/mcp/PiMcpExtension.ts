// 管理ビューと独立して、明示的に有効化した HTTP MCP を Host の寿命へ接続する。
import { watchFile, unwatchFile } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadPiMcpConfig } from "./PiMcpConfig";
import type { PiMcpSdk } from "./PiMcpSdk";
import { PiMcpServer } from "./PiMcpServer";
import { mcpIdentity } from "./PiMcpGate";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";
import type { PiAuthorize } from "../PiApprovedTools";
import type { PiToolFeatures } from "../PiToolFeatures";

/** 設定の有効化、認証、接続を自動実行する拡張コードから分離する。 */
export function neritaMcpExtension(options: {
	load: () => Promise<PiMcpSdk>;
	cwd: string;
	agentDir: string;
	projectTrusted: () => boolean;
	trustedExtensionPaths: string[];
	policy: AgentAccessPolicy;
	authorize: PiAuthorize;
	signal: AbortSignal;
	features: PiToolFeatures;
}): ExtensionFactory {
	return (pi) => {
		const servers = new Map<string, PiMcpServer>();
		let sdk: PiMcpSdk | undefined;
		let credentials: unknown;
		let queue = Promise.resolve();
		const paths = [
			join(options.agentDir, "mcp.json"),
			join(options.cwd, ".pi/mcp.json"),
		];
		/** 信頼済みとしてロードした拡張の登録だけを設定の候補に含める。 */
		const config = () =>
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
				(name, value) => sdk!.validateMcpServerConfig(name, value),
			);
		/** 変更を検出した時点で古い接続を失効させ、承認待ちも取り消す。 */
		const invalidate = () => {
			for (const server of servers.values()) {
				void server.close().catch(() => undefined);
			}
			servers.clear();
		};
		/** 設定と登録がない会話では、MCP の配布資産を読み込まない。 */
		const ensureSdk = async () => {
			if (sdk) {
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
			if (!exists.some(Boolean) && !pi.getMcpServers().length) {
				return false;
			}
			sdk = await options.load();
			return true;
		};
		/** 閉じた接続と設定改訂が変わった接続を回収する。 */
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
		/** 遅い旧接続が新しい設定の後から登録する競合を避ける。 */
		const synchronize = () => {
			queue = queue
				.catch(() => undefined)
				.then(async () => {
					if (options.signal.aborted || !(await ensureSdk())) {
						return;
					}
					const loaded = await config();
					const entries = loaded.entries.filter(
						(entry) =>
							entry.config?.enabled &&
							"url" in entry.config &&
							options.policy.networkAccess && serverPermitted(entry.name),
					);
					await removeObsolete(entries);
					for (const entry of entries) {
						options.signal.throwIfAborted();
						if (servers.has(entry.name)) {
							continue;
						}
						try {
							credentials ??= new sdk!.McpOAuthCredentialStore(
								new sdk!.FileAuthStorageBackend(
									join(options.agentDir, "mcp-auth.json"),
								),
								options.agentDir,
							);
							const server = new PiMcpServer({
								...options,
								entry,
								sdk: sdk!,
								pi,
								credentials,
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
			return queue;
		};
		/** 子に公開できる MCP ツールがないサーバーへ、接続権限だけを取得しない。 */
		const serverPermitted = (name: string): boolean => {
			const allowed = options.features.allowedTools;
			if (!allowed) { return true; }
			const prefix = sdk!.createMcpToolName(name, "");
			return allowed.some(tool => tool.startsWith(prefix));
		};
		/** 設定の追加・変更は再接続対象とし、通信には新しい承認を必要とする。 */
		const changed = () => {
			invalidate();
		};
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
			const pending = [...servers.values()].map((server) =>
				server.close(),
			);
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
	};
}
