// 接続設定と環境変数を承認後にも検査し、変更した接続へ古い許可を流用しない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { createHash } from "node:crypto";
import type { PiMcpEntry } from "./PiMcpConfig";
import type { PiAuthorize } from "../PiApprovedTools";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";
import { approveToolCall } from "../../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../../security/ApprovedToolCall";
import { evaluateTrust } from "../../../security/trust/TrustGate";
import { abortableFeatureApproval } from "../PiFeatureSafety";

/** 環境変数を展開した値を固定し、承認後の値変更を識別する。 */
export function resolvedMcpHeaders(entry: PiMcpEntry): Record<string, string> {
	if (!entry.config || !("url" in entry.config)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(entry.config.headers ?? {}).map(([key, value]) => [
			key,
			value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
				const resolved = process.env[name];
				if (resolved === undefined) {
					throw new Error(
						"MCP の認証用環境変数が設定されていません。",
					);
				}
				return resolved;
			}),
		]),
	);
}

/** HTTP はループバック検証に限定し、遠隔接続では HTTPS を必須にする。 */
export function mcpHttpUrl(value: string): URL {
	const url = new URL(value);
	if (
		isNonEmptyString(url.username) ||
		isNonEmptyString(url.password) ||
		!(
			url.protocol === "https:" ||
			(url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		)
	) {
		throw new Error(
			"MCP の接続先には HTTPS またはローカル HTTP を指定してください。",
		);
	}
	return url;
}

/** 秘密値を公開せず、設定と展開した環境変数の同一性を確認する。 */
export function mcpIdentity(entry: PiMcpEntry): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				entry.revision,
				resolvedMcpHeaders(entry),
				"url" in (entry.config ?? {}) ? entry.config : undefined,
				process.env,
			]),
		)
		.digest("hex");
}

/** 接続・認証更新先を既存の承認 UI へ提示し、実通信の直前にも信頼を再検査する。 */
export class PiMcpGate {
	private approved = new Map<
		string,
		{ signal: AbortSignal; call: Parameters<typeof evaluateTrust>[0] }
	>();
	private pending = new Map<string, Promise<void>>();
	readonly identity: string;
	constructor(
		private readonly options: {
			entry: PiMcpEntry;
			cwd: string;
			policy: AgentAccessPolicy;
			authorize: PiAuthorize;
			signal: AbortSignal;
			current: () => Promise<PiMcpEntry | undefined>;
		},
	) {
		this.identity = mcpIdentity(options.entry);
	}

	/** 設定が変わった時点で接続・承認待ちのいずれも失効させる。 */
	async check(): Promise<void> {
		const { signal, policy, current } = this.options;
		signal.throwIfAborted();
		if (!policy.networkAccess) {
			throw new Error("この役割では MCP 通信が禁止されています。");
		}
		const entry = await current();
		if (
			!(entry?.config?.enabled === true) ||
			mcpIdentity(entry) !== this.identity
		) {
			throw new Error("MCP の設定が変更されました。再接続してください。");
		}
		signal.throwIfAborted();
	}

	/** リダイレクトを自動追跡せず、認証値を未承認の接続先へ送らない。 */
	async request(
		input: Parameters<typeof fetch>[0],
		init: Parameters<typeof fetch>[1],
		operation: AbortSignal,
		oauth = false,
	): Promise<Response> {
		const target = mcpHttpUrl(
			input instanceof Request ? input.url : String(input),
		);
		const configured = mcpHttpUrl(
			(this.options.entry.config as { url: string }).url,
		);
		if (!oauth && target.href !== configured.href) {
			throw new Error("MCP の接続先が一致しません。");
		}
		const signal = AbortSignal.any([
			this.options.signal,
			operation,
			...(init?.signal ? [init.signal] : []),
		]);
		await this.check();
		const key = oauth
			? `${init?.method ?? "GET"}:${target.origin}${target.pathname}`
			: "connection";
		await this.ensureApproved(key, target, signal);
		const approved = this.approved.get(key)!;
		const combined = AbortSignal.any([signal, approved.signal]);
		await this.check();
		await evaluateTrust(approved.call);
		combined.throwIfAborted();
		return fetch(input, { ...init, redirect: "error", signal: combined });
	}

	/** 同時に来た通知が同じ接続の承認 UI を重複して開かないようにする。 */
	private async ensureApproved(
		key: string,
		target: URL,
		signal: AbortSignal,
	): Promise<void> {
		if (this.approved.get(key)?.signal.aborted === true) {
			this.approved.delete(key);
		}
		if (!this.approved.has(key)) {
			let pending = this.pending.get(key);
			if (!pending) {
				pending = this.approve(
					key,
					target,
					this.options.signal,
				).finally(() => this.pending.delete(key));
				this.pending.set(key, pending);
			}
			await abortableFeatureApproval(pending, signal);
		}
	}

	/** 承認対象へ秘密のヘッダーや URL のクエリーを載せない。 */
	private async approve(
		key: string,
		target: URL,
		signal: AbortSignal,
	): Promise<void> {
		const { entry, cwd, policy, authorize } = this.options;
		const permit = await approveToolCall(
			{
				tool: "extension:mcp_connect",
				params: {
					server: entry.name,
					scope: entry.scope,
					revision: entry.revision,
					operation: key === "connection" ? "connect" : "oauth",
					url: `${target.origin}${target.pathname}`,
				},
				cwd,
				policy,
			},
			(request, cancel) =>
				abortableFeatureApproval(authorize(request, cancel), cancel),
			signal,
		);
		const call = consumeApprovedToolCall(permit);
		await this.check();
		await evaluateTrust(call);
		permit.signal.throwIfAborted();
		this.approved.set(key, { signal: permit.signal, call });
	}
}
