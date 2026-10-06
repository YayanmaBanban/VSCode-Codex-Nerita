// 拒否から追加した権限とキャッシュ設定を保持する。保存成功前に UI や実行へ公開しない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, basename } from "node:path";
import { z } from "zod";
import {
	resourceGrantSchema,
	sandboxCacheSchema,
	type ResourceGrant,
	type SandboxCache,
	type DenialEvent,
	type ResourceDecision,
} from "@nerita/shared/sandboxPolicy";
import type { ToolCall } from "../security/ApprovedToolCall";
import { containsPath } from "../security/AgentAccessPolicy";
import type { DevToolPolicy } from "./DevToolPolicy";

const savedSchema = z.object({
	grants: resourceGrantSchema.array(),
	caches: sandboxCacheSchema.array(),
});
/** VS Code の workspaceState と同じ Host 管理領域を使う。 */
export type ResourceGrantStorage = {
	read(): unknown;
	write(state: {
		grants: ResourceGrant[];
		caches: SandboxCache[];
	}): Promise<void>;
};

/** プロファイルとの一致を毎回確認し、保存済みのパスだけで権限を付与しない。 */
export class ResourceGrantStore {
	private grants: ResourceGrant[] = [];
	private caches: SandboxCache[] = [];
	private pending = Promise.resolve();
	constructor(
		private readonly storage: ResourceGrantStorage,
		private readonly changed: () => void,
	) {
		const saved = savedSchema.safeParse(storage.read());
		if (saved.success) {
			this.grants = saved.data.grants.filter(
				(grant) => grant.scope === "workspace",
			);
			this.caches = saved.data.caches;
		}
	}
	/** 表示側から保存済み権限を変更できない。 */
	list() {
		return structuredClone(this.grants);
	}
	/** キャッシュ設定も表示側へ参照を渡さない。 */
	listCaches() {
		return structuredClone(this.caches);
	}

	/** Host が実行と照合済みのイベントにだけ権限を作る。 */
	allow(
		event: DenialEvent,
		decision: ResourceDecision,
		call: ToolCall,
		operationId: string,
		signal: AbortSignal,
	) {
		return this.enqueue(async () => {
			signal.throwIfAborted();
			const resource = event.resource;
			if (
				!resource ||
				!isNonEmptyString(resource.tool) ||
				decision.action !== "allow" ||
				!grantable(event)
			) {
				throw new Error(
					"この拒否イベントにはリソース権限を追加できません。",
				);
			}
			const target = await safeGrantTarget(event.target);
			if (!containsPath(resource.target, target)) {
				throw new Error("拒否対象がプロファイルの範囲外です。");
			}
			const grant = resourceGrantSchema.parse({
				id: randomUUID(),
				resource: {
					kind: resource.kind,
					target,
					tool: resource.tool,
					profileTarget: resource.target,
				},
				access: "read",
				scope: decision.scope,
				source: "denial",
				workspace: workspaceFor(call),
				denialEventId: event.id,
				operationId,
			});
			const next = this.grants.filter(
				(item) =>
					!(
						item.workspace === grant.workspace &&
						item.resource.target === target &&
						item.resource.tool === resource.tool &&
						item.scope === grant.scope
					),
			);
			next.push(grant);
			await this.persist(next, this.caches);
			// 保存中に停止された process/session 許可は公開後直ちに回収する。
			if (signal.aborted && grant.scope !== "workspace") {
				this.grants = this.grants.filter(
					(item) => item.id !== grant.id,
				);
				this.changed();
			}
			signal.throwIfAborted();
		});
	}

	/** ホストキャッシュへの RW は作らず、workspace の切替と原因のツールを保存する。 */
	switchCache(event: DenialEvent, call: ToolCall, signal: AbortSignal) {
		return this.enqueue(async () => {
			signal.throwIfAborted();
			if (
				event.resource?.kind !== "cache" ||
				!isNonEmptyString(event.resource.tool) ||
				event.resourceType !== "file"
			) {
				throw new Error("キャッシュ以外の保存先は切り替えられません。");
			}
			const workspace = workspaceFor(call);
			const tool = event.resource.tool;
			const caches = this.caches.filter(
				(item) => !(item.workspace === workspace && item.tool === tool),
			);
			caches.push({ id: randomUUID(), workspace, tool });
			await this.persist(this.grants, caches);
			signal.throwIfAborted();
		});
	}

	/** 保存失敗時にはメモリーも表示も残す。 */
	revoke(id: string, cache = false) {
		return this.enqueue(() =>
			this.persist(
				cache
					? this.grants
					: this.grants.filter((item) => item.id !== id),
				cache
					? this.caches.filter((item) => item.id !== id)
					: this.caches,
			),
		);
	}
	/** 接続終了時にメモリーだけの権限を捨てる。 */
	clearSession() {
		return this.enqueue(() => {
			this.grants = this.grants.filter(
				(item) => item.scope === "workspace",
			);
			this.changed();
			return Promise.resolve();
		});
	}
	/** 成功・失敗・停止のすべてで再実行専用の権限を回収する。 */
	finish(operationId: string) {
		return this.enqueue(() => {
			this.grants = this.grants.filter(
				(item) =>
					item.scope !== "process" ||
					item.operationId !== operationId,
			);
			this.changed();
			return Promise.resolve();
		});
	}
	/** 呼出し別の既定キャッシュと、明示的な永続キャッシュを切り替える。 */
	usesCache(call: ToolCall) {
		return this.caches.some(
			(item) => item.workspace === workspaceFor(call),
		);
	}
	/** 正規化パスと検出プロファイルを実行直前に照合する。 */
	async apply(
		policy: DevToolPolicy,
		call: ToolCall,
		operationId: string,
	): Promise<DevToolPolicy> {
		const resources = [...policy.resources];
		for (const grant of this.grants) {
			if (
				grant.workspace !== workspaceFor(call) ||
				(grant.scope === "process" && grant.operationId !== operationId)
			) {
				continue;
			}
			const profile = policy.resources.find(
				(item) =>
					item.kind === grant.resource.kind &&
					item.tool === grant.resource.tool &&
					item.target === grant.resource.profileTarget &&
					containsPath(item.target, grant.resource.target),
			);
			if (!profile) {
				continue;
			}
			await safeGrantTarget(grant.resource.target);
			resources.push({
				id: grant.id,
				kind: grant.resource.kind,
				target: grant.resource.target,
				tool: grant.resource.tool,
				access: grant.access,
				source: grant.source,
				scope: grant.scope,
			});
		}
		return { ...policy, resources };
	}
	private async persist(grants: ResourceGrant[], caches: SandboxCache[]) {
		await this.storage.write(
			structuredClone({
				grants: grants.filter((item) => item.scope === "workspace"),
				caches,
			}),
		);
		this.grants = [...grants];
		this.caches = [...caches];
		this.changed();
	}
	private enqueue(operation: () => Promise<void>) {
		const result = this.pending.then(operation);
		this.pending = result.catch(() => {});
		return result;
	}
}

/** 一番近いワークスペースを選び、別ルートの権限を混ぜない。 */
export function workspaceFor(call: ToolCall): string {
	const workspace = call.policy.workspaceRoots
		.filter((root) => containsPath(root, call.cwd))
		.sort((a, b) => b.length - a.length)[0];
	if (!isNonEmptyString(workspace)) {
		throw new Error("Sandbox の workspace 境界外です。");
	}
	return workspace;
}

/** 認証用ファイルや書込み要求を通常の読取り許可へ変換しない。 */
export function grantable(event: DenialEvent): boolean {
	return (
		event.resourceType === "file" &&
		!!isNonEmptyString(event.resource?.tool) &&
		["install", "helper", "config"].includes(event.resource.kind) &&
		["read", "execute"].includes(event.requestedAccess) &&
		!/(?:^|[\\/])(?:\.ssh|\.aws|\.azure|\.gnupg|credentials|secrets?)(?:[\\/]|$)/i.test(
			event.target,
		) &&
		!/^\.(?:npmrc|gitconfig|netrc|env)(?:\.|$)/i.test(
			basename(event.target),
		)
	);
}

/** Object Manager パス、親への拡張、junction の差替えを拒否する。 */
async function safeGrantTarget(target: string): Promise<string> {
	if (
		!isAbsolute(target) ||
		normalize(target) !== target ||
		target === parse(target).root ||
		target.includes("\0")
	) {
		throw new Error("正規化されたファイルパスだけを許可できます。");
	}
	if ((await realpath(target)) !== target) {
		throw new Error("リソースのパスが変更されています。");
	}
	return target;
}
