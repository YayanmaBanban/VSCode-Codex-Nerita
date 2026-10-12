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
/** 永続権限とキャッシュ設定を読み書きする Host 側の保存先。 */
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
	/** 保存値を検証し、ワークスペース許可とキャッシュ選択だけを次の起動へ復元する。 */
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
	/** 永続権限とキャッシュ設定だけ同期し、別 Run の一時権限を取り込まない。 */
	refreshWorkspace(): void {
		const saved = savedSchema.safeParse(this.storage.read());
		if (saved.success) {
			this.grants = [
				...this.grants.filter((grant) => grant.scope !== "workspace"),
				...saved.data.grants.filter(
					(grant) => grant.scope === "workspace",
				),
			];
			this.caches = saved.data.caches;
			this.changed();
		}
	}

	/** Host が実行と照合済みのイベントにだけ権限を作る。 */
	allow(
		event: DenialEvent,
		decision: ResourceDecision,
		call: ToolCall,
		operationId: string,
		signal: AbortSignal,
	) {
		/** 拒否対象と権限上限を照合して保存し、保存中に停止された一時許可は公開後に回収する。 */
		const persistDenialGrant = async () => {
			signal.throwIfAborted();
			const resource = event.resource;

			if (!resource) {
				throw new Error(
					"この拒否イベントにはリソース権限を追加できません。",
				);
			}
			if (!isNonEmptyString(resource.tool)) {
				throw new Error(
					"この拒否イベントにはリソース権限を追加できません。",
				);
			}
			if (decision.action !== "allow") {
				throw new Error(
					"この拒否イベントにはリソース権限を追加できません。",
				);
			}
			if (!grantable(event)) {
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
			const next = this.grants.filter((item) => {
				const sameTarget =
					item.workspace === grant.workspace &&
					item.resource.target === target &&
					item.resource.tool === resource.tool;
				return !(sameTarget && item.scope === grant.scope);
			});
			next.push(grant);
			await this.persist(next, this.caches);
			// 保存中に停止された実行やセッションの一時権限は、公開後直ちに回収する。
			if (signal.aborted && grant.scope !== "workspace") {
				this.grants = this.grants.filter(
					(item) => item.id !== grant.id,
				);
				this.changed();
			}
			signal.throwIfAborted();
		};
		return this.enqueue(persistDenialGrant);
	}

	/** ホストキャッシュへの書込み権限は作らず、ワークスペースごとにキャッシュの切替対象のツールを保存する。 */
	switchCache(event: DenialEvent, call: ToolCall, signal: AbortSignal) {
		/** キャッシュの拒否だけを対象に、ワークスペースとツールごとの選択を保存する。 */
		const persistSandboxCacheChoice = async () => {
			signal.throwIfAborted();

			if (event.resource?.kind !== "cache") {
				throw new Error("キャッシュ以外の保存先は切り替えられません。");
			}
			if (!isNonEmptyString(event.resource.tool)) {
				throw new Error("キャッシュ以外の保存先は切り替えられません。");
			}
			if (event.resourceType !== "file") {
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
		};
		return this.enqueue(persistSandboxCacheChoice);
	}

	/** 保存失敗時はメモリー上の状態と表示を維持する。 */
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
			const matchesWorkspace =
				grant.workspace !== workspaceFor(call) ||
				(grant.scope === "process" &&
					grant.operationId !== operationId);
			if (matchesWorkspace) {
				continue;
			}
			const profile = policy.resources.find((item) => {
				const matchesKind2 = !(
					item.kind === grant.resource.kind &&
					item.tool === grant.resource.tool &&
					item.target === grant.resource.profileTarget
				);
				if (matchesKind2) {
					return false;
				}
				return containsPath(item.target, grant.resource.target);
			});
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
	/** ワークスペース許可だけを永続化し、保存成功後にメモリー上の許可とキャッシュ選択を公開する。 */
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
	/** 許可の更新を直列化し、失敗した要求が後続の待機列を止めないようにする。 */
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
		throw new Error("Sandbox のワークスペースの範囲外です。");
	}
	return workspace;
}

/** 認証用ファイルや書込み要求を通常の読取り許可へ変換しない。 */
export function grantable(event: DenialEvent): boolean {
	if (!(event.resourceType === "file")) {
		return false;
	}
	if (!isNonEmptyString(event.resource?.tool)) {
		return false;
	}
	if (!["install", "helper", "config"].includes(event.resource.kind)) {
		return false;
	}
	return (
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
	if (!isAbsolute(target)) {
		throw new Error("正規化されたファイルパスだけを許可できます。");
	}
	if (normalize(target) !== target) {
		throw new Error("正規化されたファイルパスだけを許可できます。");
	}
	if (target === parse(target).root) {
		throw new Error("正規化されたファイルパスだけを許可できます。");
	}
	if (target.includes("\0")) {
		throw new Error("正規化されたファイルパスだけを許可できます。");
	}
	const matchesValue = (await realpath(target)) !== target;
	if (matchesValue) {
		throw new Error("リソースのパスが変更されています。");
	}
	return target;
}
