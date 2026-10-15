// 信頼状態を Host に保存し、変更時は発行済みの実行許可を失効させる。
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { containsPath } from "../AgentAccessPolicy";
import { canonicalPath } from "../WorkspacePathPolicy";
import { z } from "zod";
import { hasNestedRepository } from "./TrustRepositoryBoundary";
import type { BackendId } from "@nerita/shared/backend";
import type { TrustReply } from "@nerita/shared/workspaceTrust";
import type { CodexWorkspaceTrust } from "../../backends/codex/settings/CodexWorkspaceTrust";

const savedTrust = z
	.object({
		version: z.literal(1),
		records: z.array(
			z
				.object({
					root: z.string().refine((path) => resolve(path) === path),
					trust: z.enum(["trusted", "untrusted"]),
					origin: z.enum(["workspace", "external", "external-cache"]),
					updatedAt: z.number(),
					identity: z
						.object({
							dev: z.number(),
							ino: z.number(),
							birthtimeMs: z.number(),
						})
						.optional(),
				})
				.strict(),
		),
	})
	.strict();

/** 外部由来の記録はユーザーの信頼操作でも保持する。 */
export type TrustRecord = {
	root: string;
	trust: "trusted" | "untrusted";
	origin: "workspace" | "external" | "external-cache";
	updatedAt: number;
	identity?: { dev: number; ino: number; birthtimeMs: number } | undefined;
};
/** 保存先は Host が所有し、モデルやワークスペース設定から差し替えない。 */
export type TrustStorage = {
	read(): unknown;
	write(value: { version: 1; records: TrustRecord[] }): Promise<void>;
};
/** ログには操作の種別とルートだけを渡し、本文や認証情報を含めない。 */
export type TrustAudit = (event: string, root: string) => void;

/** Windows の大小文字差を保存キーへ反映させない。 */
export function trustKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

/** 不明な保存形式は全体を未信頼として復元する。 */
export class WorkspaceTrustStore {
	private records = new Map<string, TrustRecord>();
	private controller = new AbortController();
	private rootControllers = new Map<
		string,
		{ root: string; controller: AbortController }
	>();
	private queue: Promise<void> = Promise.resolve();
	private failed = false;
	private pendingRestrictions = new Map<object, string | undefined>();
	private listeners = new Set<(root?: string, backend?: BackendId) => void>();
	/** 保存済みの信頼を検証し、破損や重複があれば全件を未信頼として扱う。 */
	constructor(
		private readonly storage: TrustStorage,
		readonly audit: TrustAudit = () => {},
		private readonly codex?: CodexWorkspaceTrust,
	) {
		try {
			const data = storage.read();
			if (data === undefined) {
				return;
			}
			for (const record of savedTrust.parse(data).records) {
				if (this.records.has(trustKey(record.root))) {
					throw new Error("重複したTrust記録です。");
				}
				this.records.set(trustKey(record.root), { ...record });
			}
		} catch {
			this.records.clear();
			this.failed = true;
		}
	}
	/** 状態変更前のシグナルを保持した要求は再利用できない。 */
	get signal(): AbortSignal {
		return this.controller.signal;
	}
	/** 保存前・保存後の通知を受けた表示は、進行中の保存が完了してから再照合する。 */
	async waitForChanges(): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.queue;
			await pending;
		} while (pending !== this.queue);
	}
	/** 独立した Worktree の信頼変更では既存の許可を失効させず、親子ルートの変更には追随する。 */
	signalFor(root: string): AbortSignal {
		const key = trustKey(resolve(root));
		let scoped = this.rootControllers.get(key);
		if (!scoped) {
			scoped = { root: resolve(root), controller: new AbortController() };
			this.rootControllers.set(key, scoped);
		}
		return scoped.controller.signal;
	}
	/** 表示用に返した記録を変更しても、Host 内の信頼記録には影響しない。 */
	list(): TrustRecord[] {
		return [...this.records.values()].map((record) => ({ ...record }));
	}
	/** VS Code 側の状態変更でも待機中の要求を失効させる。 */
	invalidate(root?: string, backend: BackendId = "pi"): void {
		if (backend === "codex") {
			for (const listener of this.listeners) {
				listener(root, backend);
			}
			return;
		}
		const previous = this.controller;
		this.controller = new AbortController();
		const reason = new Error(
			"ワークスペースの信頼設定が変更されました。再接続してください。",
		);
		previous.abort(reason);
		for (const scoped of this.rootControllers.values()) {
			const matchesRoot =
				root === undefined ||
				containsPath(root, scoped.root) ||
				containsPath(scoped.root, root);
			if (matchesRoot) {
				const old = scoped.controller;
				scoped.controller = new AbortController();
				old.abort(reason);
			}
		}
		for (const listener of this.listeners) {
			listener(root, backend);
		}
	}
	/** 信頼状態の変更を購読し、UI の表示更新とセッションの取り消しに使う。 */
	onChange(
		listener: (root?: string, backend?: BackendId) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	/** 実体パスを照合し、最も深い登録ルートの状態を採用する。 */
	async trusted(path: string, backend: BackendId = "pi"): Promise<boolean> {
		if (backend === "codex") {
			return this.codex?.trusted(path) ?? false;
		}
		return this.trustedPi(path);
	}
	/** Pi の実体識別と外部取得物の境界は Nerita の記録で照合する。 */
	private async trustedPi(path: string): Promise<boolean> {
		if (this.failed) {
			return false;
		}
		try {
			const actual = await canonicalPath(path, process.cwd());
			const matchesSome = [...this.pendingRestrictions.values()].some(
				(root) =>
					root === undefined ||
					containsPath(root, actual) ||
					containsPath(actual, root),
			);
			if (matchesSome) {
				return false;
			}
			const record = this.list()
				.filter((item) => containsPath(item.root, actual))
				.sort((a, b) => b.root.length - a.root.length)[0];
			const matchesRecord = !(
				!!record &&
				record.trust === "trusted" &&
				(await sameRootIdentity(record))
			);
			if (matchesRecord) {
				return false;
			}
			return !(await hasNestedRepository(record.root, actual));
		} catch {
			return false;
		}
	}
	/** 外部ルートは親が信頼済みでも独立した未信頼の記録にする。 */
	registerExternal(root: string): Promise<void> {
		return this.change(root, false, "external");
	}
	/** キャッシュ全体の信頼では、新しく取得するリポジトリへ許可を継承させない。 */
	async registerExternalCache(root: string): Promise<void> {
		const canonical = await canonicalPath(root, process.cwd());
		const matchesOrigin =
			this.records.get(trustKey(canonical))?.origin !== "external-cache";
		if (matchesOrigin) {
			await this.change(canonical, false, "external-cache");
		}
	}
	/** 初めて開いたルートを登録し、既存の明示的な信頼を上書きしない。 */
	async registerWorkspace(
		root: string,
		backend: BackendId = "pi",
	): Promise<void> {
		if (backend === "codex") {
			await this.requireCodex().registerWorkspace(root);
			return;
		}
		const canonical = await canonicalPath(root, process.cwd());
		if (!this.records.has(trustKey(canonical))) {
			await this.change(canonical, false, "workspace");
		}
	}
	/** この入口は Host のユーザー操作だけから呼び、モデルのツールへ公開しない。 */
	setUserTrust(
		root: string,
		trusted: boolean,
		expected?: TrustRecord["identity"],
	): Promise<void> {
		return this.change(root, trusted, undefined, expected);
	}
	/** 表示するバックエンドの保存先から最新の一覧を取得する。 */
	async listFor(backend: BackendId): Promise<TrustReply["records"]> {
		return backend === "codex" ? this.requireCodex().list() : this.list();
	}
	/** 信頼変更は選択したバックエンドの保存先へだけ反映する。 */
	setBackendTrust(
		root: string,
		trust: "trusted" | "untrusted" | "unset",
		backend: BackendId,
		expected?: TrustRecord["identity"],
	): Promise<void> {
		if (backend === "codex") {
			return this.requireCodex().change(root, trust, expected);
		}
		return trust === "unset"
			? this.remove(root)
			: this.setUserTrust(root, trust === "trusted", expected);
	}
	/** Codex の設定 API がない環境を、無条件の信頼へ切り替えない。 */
	private requireCodex(): CodexWorkspaceTrust {
		if (!this.codex) {
			throw new Error("Codex の信頼管理を初期化できません。");
		}
		return this.codex;
	}
	/** 存在しなくなったフォルダも保存済みのキーで削除する。 */
	remove(root: string): Promise<void> {
		const scope = this.changeScope(root);
		const release = this.restrict(scope);
		this.invalidate(scope);
		/** 親の信頼が残る場合は拒否記録を削除せず、削除結果を保存してから監査へ通知する。 */
		const removeTrustRecord = async () => {
			const record = this.records.get(trustKey(root));
			if (!record) {
				return;
			}
			// 拒否の記録を削除して、親の信頼が復活することを防ぐ。
			const matchesSome2 = this.list().some(
				(parent) =>
					parent.root !== record.root &&
					parent.trust === "trusted" &&
					containsPath(parent.root, record.root),
			);
			if (matchesSome2) {
				throw new Error(
					"親フォルダの信頼を取り消してから、この記録を削除してください。",
				);
			}
			const records = new Map(this.records);
			records.delete(trustKey(root));
			await this.persistRecords(records);
			this.audit("user-removed", root);
		};
		const action = this.queue.then(removeTrustRecord).finally(() => {
			release();
			this.invalidate(scope);
		});
		this.queue = action.catch(() => {});
		return action;
	}
	/** 保存を直列化し、取消しを保存待ちの間も有効にする。 */
	private change(
		root: string,
		trusted: boolean,
		origin?: TrustRecord["origin"],
		expected?: TrustRecord["identity"],
	): Promise<void> {
		const scope = this.changeScope(root, origin);
		const release = trusted ? undefined : this.restrict(scope);
		if (!trusted) {
			this.invalidate(scope);
		}
		/** ルートの実体と信頼条件を検証してから保存し、保存成功後に実行中の対象を無効化する。 */
		const persistValidatedTrust = async () => {
			const canonical = await canonicalPath(root, process.cwd());
			const identity = await validateTrustRoot(
				canonical,
				trusted,
				this.records.get(trustKey(canonical)),
				expected,
			);
			const records = new Map(this.records);
			records.set(trustKey(canonical), {
				root: canonical,
				trust: trusted ? "trusted" : "untrusted",
				origin: recordOrigin(canonical, records, origin),
				updatedAt: Date.now(),
				identity,
			});
			await this.persistRecords(records);
			this.failed = false;
			const event = trusted ? "user-trusted" : "user-revoked";
			this.audit(registrationEvent(origin, event), canonical);
			this.invalidate(this.changeScope(canonical, origin));
		};
		const action = this.queue.then(persistValidatedTrust).finally(() => {
			// 保存失敗による拒否は `failed` で維持し、保存待ちの制限カウンターだけを減らす。
			if (!trusted) {
				release?.();
				this.invalidate(scope);
			}
		});
		this.queue = action.catch(() => {});
		return action;
	}
	/** 保存した記録だけを公開し、保存失敗は全ルートの信頼失効として扱う。 */
	private async persistRecords(
		records: Map<string, TrustRecord>,
	): Promise<void> {
		try {
			await this.storage.write({
				version: 1,
				records: [...records.values()],
			});
		} catch (error) {
			this.failed = true;
			this.invalidate();
			throw error;
		}
		this.records = records;
	}
	/** 外部コードの信頼変更は読み込んだ拡張にも影響するため、すべての実行許可を失効させる。 */
	private changeScope(
		root: string,
		origin?: TrustRecord["origin"],
	): string | undefined {
		return recordOrigin(resolve(root), this.records, origin) === "workspace"
			? resolve(root)
			: undefined;
	}
	/** 保存待ちの制限を対象ルートへ適用する。保存失敗後は `failed` によって全ルートの拒否を維持する。 */
	private restrict(root: string | undefined): () => void {
		const token = {};
		this.pendingRestrictions.set(token, root);
		return () => this.pendingRestrictions.delete(token);
	}
}

/** 初回のワークスペース登録と外部取得を監査で区別する。 */
function registrationEvent(
	origin: TrustRecord["origin"] | undefined,
	fallback: string,
): string {
	if (!(origin !== undefined)) {
		return fallback;
	}
	return origin === "workspace"
		? "workspace-registered"
		: "external-registered";
}

/** 昇格時は未作成の場所や単一ファイルを受け付けない。 */
async function validateTrustRoot(
	root: string,
	trusted: boolean,
	record?: TrustRecord,
	expected?: TrustRecord["identity"],
) {
	if (trusted && record?.origin === "external-cache") {
		throw new Error(
			"外部キャッシュ全体は信頼できません。取得したrepoを個別に選択してください。",
		);
	}
	if (!trusted) {
		return undefined;
	}
	const info = await stat(root);
	if (!info.isDirectory()) {
		throw new Error("信頼する対象にはフォルダを指定してください。");
	}
	const identity = {
		dev: info.dev,
		ino: info.ino,
		birthtimeMs: info.birthtimeMs,
	};
	if (expected && JSON.stringify(identity) !== JSON.stringify(expected)) {
		throw new Error(
			"信頼の確認中に対象が変更されました。もう一度確認してください。",
		);
	}
	return identity;
}

/** 同じパスへ再作成された一時リポジトリを以前の信頼で実行しない。 */
async function sameRootIdentity(record: TrustRecord): Promise<boolean> {
	if (!record.identity) {
		return false;
	}
	const canonicalRoot = trustKey(await realpath(record.root));
	if (canonicalRoot !== trustKey(record.root)) {
		return false;
	}
	const info = await stat(record.root);

	if (!info.isDirectory()) {
		return false;
	}
	if (info.dev !== record.identity.dev) {
		return false;
	}
	if (info.ino !== record.identity.ino) {
		return false;
	}
	return info.birthtimeMs === record.identity.birthtimeMs;
}

/** 外部ツリー配下を個別に信頼しても、出所の記録を失わない。 */
function recordOrigin(
	root: string,
	records: Map<string, TrustRecord>,
	explicit?: TrustRecord["origin"],
): TrustRecord["origin"] {
	const inherited = [...records.values()].some(
		(record) =>
			record.origin !== "workspace" && containsPath(record.root, root),
	)
		? "external"
		: "workspace";
	return explicit ?? records.get(trustKey(root))?.origin ?? inherited;
}
