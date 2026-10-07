// 1サーバーの接続・動的定義・停止を所有し、古い定義の実行を拒否する。
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PiMcpEntry } from "./PiMcpConfig";
import type { PiMcpSdk, PiMcpConnection } from "./PiMcpSdk";
import { PiMcpGate, resolvedMcpHeaders, mcpHttpUrl } from "./PiMcpGate";
import { approvedMcpTool, safeMcpResult, safeMcpResource } from "./PiMcpTools";
import { MCP_RESULT_UNKNOWN_TEXT } from "../results/PiResultDisplay";
import type { PiAuthorize } from "../PiApprovedTools";
import { piToolPermitted, type PiToolFeatures } from "../PiToolFeatures";
import { piFeatureSecrets } from "../PiFeatureSecrets";
import {
	abortableFeatureApproval,
	privateFeatureResult,
} from "../PiFeatureSafety";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";

/** 1接続の出所と権限は生成後に変更せず、設定変更では接続ごと交換する。 */
export type PiMcpServerOptions = {
	entry: PiMcpEntry;
	sdk: PiMcpSdk;
	pi: ExtensionAPI;
	cwd: string;
	agentDir: string;
	policy: AgentAccessPolicy;
	authorize: PiAuthorize;
	signal: AbortSignal;
	features: PiToolFeatures;
	credentials: unknown;
	flushCredentials?: () => Promise<void>;
	current: () => Promise<PiMcpEntry | undefined>;
};

/** 変更通知で追加・削除された定義にも、Host の承認境界を適用する。 */
export class PiMcpServer {
	private controller = new AbortController();
	private lifetime: AbortSignal;
	private operation: AbortSignal;
	private connection: PiMcpConnection;
	private gate: PiMcpGate;
	private registered = new Map<string, ToolDefinition>();
	private names = new Map<string, string>();
	private closing?: Promise<void>;
	readonly identity: string;
	private timeoutMs: number;
	/** Stop で閉じた接続は次の会話要求で新しく接続する。 */
	get active(): boolean {
		return !this.lifetime.aborted;
	}
	constructor(private readonly options: PiMcpServerOptions) {
		const { entry, sdk, signal, credentials } = options;
		if (!entry.config || !("url" in entry.config)) {
			throw new Error("stdio MCP は上流対応の対象です。");
		}
		const url = entry.config.url;
		mcpHttpUrl(url);
		this.timeoutMs = Math.min(60000, (entry.config.timeout ?? 60) * 1000);
		this.lifetime = AbortSignal.any([signal, this.controller.signal]);
		this.operation = this.lifetime;
		this.gate = new PiMcpGate({ ...options, signal: this.lifetime });
		this.identity = this.gate.identity;
		this.connection = new sdk.McpServerConnection({
			entry: {
				name: entry.name,
				config: entry.config,
				scope: entry.scope,
				source: entry.source,
			},
			cwd: options.cwd,
			credentials,
			oauthFetch: (input, init) =>
				this.gate.request(input, init, this.operation, true),
			createTransport: (_entry, _cwd, authProvider) =>
				new sdk.StreamableHttpTransport({
					url,
					headers: resolvedMcpHeaders(entry),
					authProvider,
					fetch: (input, init) =>
						this.gate.request(input, init, this.operation),
					maxMessageBytes: 1024 * 1024,
				}),
			onTools: () => this.registerTools(),
		});
		this.lifetime.addEventListener("abort", this.onAbort, { once: true });
	}

	/** 初回接続も承認待ちを含めて60秒以内に終える。 */
	async connect(): Promise<void> {
		const signal = AbortSignal.any([
			this.lifetime,
			AbortSignal.timeout(this.timeoutMs),
		]);
		this.operation = signal;
		try {
			await abortableFeatureApproval(this.connection.getClient(), signal);
			await this.options.flushCredentials?.();
		} catch {
			await this.close();
			throw new Error(
				"MCP を接続できませんでした。設定・認証・承認状態を確認してください。",
			);
		} finally {
			this.operation = this.lifetime;
		}
	}

	/** 再登録で SDK の登録簿を更新し、消えた定義は非公開にする。 */
	private registerTools(): void {
		if (this.lifetime.aborted) {
			return;
		}
		const current = new Set<string>();
		for (const tool of this.connection.tools.slice(0, 256)) {
			const definition = this.toolDefinition(tool);
			if (definition) {
				current.add(definition.name);
				this.register(definition);
			}
		}
		if (this.connection.hasResources) {
			for (const action of [
				"list_resources",
				"list_resource_templates",
				"read_resource",
			] as const) {
				const definition = this.resourceDefinition(action);
				if (definition) {
					current.add(definition.name);
					this.register(definition);
				}
			}
		}
		for (const name of this.registered.keys()) {
			if (!current.has(name)) {
				this.hide(name);
			}
		}
	}

	/** サーバーの定義とリソース操作が同名でも、別の名前を割り当てる。 */
	private allocate(key: string, label: string): string | undefined {
		const existing = this.names.get(key);
		if (isNonEmptyString(existing)) {
			return existing;
		}
		if (this.names.size >= 512) {
			return;
		}
		const { sdk, entry, pi } = this.options;
		const name = sdk.createMcpToolName(
			entry.name,
			label,
			(candidate) =>
				[...this.names.values()].includes(candidate) ||
				pi.getAllTools().some((item) => item.name === candidate),
		);
		this.names.set(key, name);
		return name;
	}

	/** 遠隔ツールの読取りヒントを、自動許可の根拠にしない。 */
	private toolDefinition(
		tool: PiMcpConnection["tools"][number],
	): ToolDefinition | undefined {
		const { sdk, entry, features } = this.options;
		const exposure = sdk.getMcpToolExposure(entry.config!, tool.name);
		const name = this.allocate(`tool:${tool.name}`, tool.name);
		if (
			!isNonEmptyString(name) ||
			exposure === "hidden" ||
			!piToolPermitted(name, features)
		) {
			return;
		}
		return {
			name,
			label: `${entry.name}: ${tool.name}`,
			description: (tool.description ?? tool.name).slice(0, 8192),
			parameters: tool.inputSchema,
			exposure: sdk.toToolExposure(exposure),
			namespace: { name: `mcp__${entry.name}` },
			execute: async (_id, args, signal) => {
				if (!signal) {
					throw new Error("MCP 実行の取消しが接続されていません。");
				}
				await abortableFeatureApproval(
					this.connection.getClient(),
					signal,
				);
				const current = this.connection.tools.find(
					(item) => item.name === tool.name,
				);
				if (JSON.stringify(current) !== JSON.stringify(tool)) {
					throw new Error("MCP のツール定義が変更されました。");
				}
				return this.run(name, signal, () =>
					this.connection.callTool(
						tool.name,
						z.record(z.string(), z.unknown()).parse(args),
						{ signal, timeoutMs: this.timeoutMs },
					),
				);
			},
		};
	}

	/** リソースの列挙・読取りも個別の実引数で承認する。 */
	private resourceDefinition(
		action: "list_resources" | "list_resource_templates" | "read_resource",
	): ToolDefinition | undefined {
		const { sdk, entry, features } = this.options;
		const exposure = entry.config!.exposure ?? "deferred";
		const name = this.allocate(`resource:${action}`, action);
		if (
			!isNonEmptyString(name) ||
			exposure === "hidden" ||
			!piToolPermitted(name, features)
		) {
			return;
		}
		return {
			name,
			label: `${entry.name}: ${action}`,
			description: `MCP ${action}`,
			parameters: {
				type: "object",
				properties:
					action === "read_resource"
						? { uri: { type: "string", maxLength: 4096 } }
						: { cursor: { type: "string", maxLength: 4096 } },
				...(action === "read_resource" ? { required: ["uri"] } : {}),
				additionalProperties: false,
			},
			exposure: sdk.toToolExposure(exposure),
			namespace: { name: `mcp__${entry.name}` },
			execute: async (_id, args, signal) => {
				if (!signal) {
					throw new Error("MCP 実行の取消しが接続されていません。");
				}
				return this.run(
					name,
					signal,
					() =>
						this.resourceRequest(
							action,
							z
								.object({
									uri: z.string().max(4096).optional(),
									cursor: z.string().max(4096).optional(),
								})
								.parse(args),
							signal,
						),
					true,
				);
			},
		};
	}

	/** SDK の読取り専用操作へ、同じ有限の要求期限を渡す。 */
	private resourceRequest(
		action: string,
		args: { uri?: string | undefined; cursor?: string | undefined },
		signal: AbortSignal,
	): Promise<unknown> {
		const options = { signal, timeoutMs: this.timeoutMs };
		if (action === "read_resource") {
			return this.connection.readResource(args.uri!, options);
		}
		if (action === "list_resources") {
			return this.connection.resourcesPage(args.cursor, options);
		}
		return this.connection.resourceTemplatesPage(args.cursor, options);
	}

	/** 結果を SDK の通知・会話履歴へ渡す前に、現在の認証値を除去する。 */
	private async run(
		name: string,
		signal: AbortSignal,
		request: () => Promise<unknown>,
		resource = false,
	) {
		await this.gate.check();
		if (!this.registered.has(name)) {
			throw new Error("この MCP ツールは現在利用できません。");
		}
		this.operation = signal;
		const cancel = () => {
			void this.close();
		};
		signal.addEventListener("abort", cancel, { once: true });
		try {
			const result = await abortableFeatureApproval(request(), signal);
			await this.options.flushCredentials?.();
			await this.gate.check();
			signal.throwIfAborted();
			const secrets = [
				...Object.values(
					resolvedMcpHeaders(this.options.entry),
				).flatMap((value) => [value, value.replace(/^Bearer\s+/i, "")]),
				...(await piFeatureSecrets()),
			];
			const safe = resource
				? safeMcpResource(result, secrets)
				: safeMcpResult(result, secrets);
			return privateFeatureResult(
				safe,
				[],
				this.options.features.protect,
			);
		} catch {
			// 要求開始後の切断・期限・取消しでは、遠隔側の副作用を取り消せたとは判断できない。
			const result = safeMcpResult(
				{
					content: [{ type: "text", text: MCP_RESULT_UNKNOWN_TEXT }],
					isError: true,
				},
				[],
			);
			return {
				...result,
				details: {
					...(isRecord(result.details) ? result.details : {}),
					outcome: "unknown",
				},
			};
		} finally {
			signal.removeEventListener("abort", cancel);
			this.operation = this.lifetime;
		}
	}

	/** 直接・検索・コードから同じ実引数に対する承認を必ず通す。 */
	private register(tool: ToolDefinition): void {
		this.registered.set(tool.name, tool);
		this.options.pi.registerTool(
			approvedMcpTool(tool, {
				...this.options,
				lifetime: this.lifetime,
				timeoutMs: this.timeoutMs,
				check: async () => {
					await this.gate.check();
					if (this.registered.get(tool.name) !== tool) {
						throw new Error(
							"MCP のツール定義が変更されました。再実行してください。",
						);
					}
				},
			}),
		);
	}

	/** SDK に削除 API がないため、実行できない非公開の定義で置き換える。 */
	private hide(name: string): void {
		const old = this.registered.get(name);
		if (!old) {
			return;
		}
		this.registered.delete(name);
		this.options.pi.registerTool({
			...old,
			exposure: "hidden",
			defaultActive: false,
			execute: () =>
				Promise.reject(new Error("この MCP ツールは無効です。")),
		});
		this.options.features.registry?.delete(name);
	}

	/** 承認と通信を先に失効させてから、接続の終了を待つ。 */
	close(): Promise<void> {
		if (!this.closing) {
			this.lifetime.removeEventListener("abort", this.onAbort);
			this.controller.abort();
			for (const name of [...this.registered.keys()]) {
				this.hide(name);
			}
			this.closing = this.connection.close();
		}
		return this.closing;
	}
	/** 親の寿命と接続の寿命を一致させる。 */
	private onAbort = () => {
		void this.close().catch(() => undefined);
	};
}
