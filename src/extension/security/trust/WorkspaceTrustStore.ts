// 信頼状態を Host に保存し、変更時は発行済みの実行許可を失効させる。
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { containsPath } from "../AgentAccessPolicy";
import { canonicalPath } from "../WorkspacePathPolicy";
import { z } from "zod";
import { hasNestedRepository } from "./TrustRepositoryBoundary";

const savedTrust = z
	.object({
		version: z.literal(1),
		records: z.array(
			z
				.object({
					root: z.string().refine((path) => resolve(path) === path),
					trust: z.enum(["trusted", "untrusted"]),
					origin: z.enum(["workspace", "external", "external-cache"]),
					updatedAt: z.number().finite(),
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
/** 保存先は Host が所有し、モデルや workspace 設定から差し替えない。 */
export type TrustStorage = {
	read(): unknown;
	write(value: { version: 1; records: TrustRecord[] }): Promise<void>;
};
/** ログには操作の種別と root だけを渡し、本文や認証情報を含めない。 */
export type TrustAudit = (event: string, root: string) => void;

/** Windows の大小文字差を保存キーへ反映させない。 */
export function trustKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

/** 不明な保存形式は全体を未信頼として復元する。 */
export class WorkspaceTrustStore {
	private records = new Map<string, TrustRecord>();
	private controller = new AbortController();
	private queue: Promise<void> = Promise.resolve();
	private failed = false;
	private pendingRestrictions = 0;
	private listeners = new Set<() => void>();
	constructor(
		private readonly storage: TrustStorage,
		readonly audit: TrustAudit = () => {},
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
	/** 表示用コピーの変更は正本へ影響しない。 */
	list(): TrustRecord[] {
		return [...this.records.values()].map((record) => ({ ...record }));
	}
	/** VS Code 側の状態変更でも待機中の要求を失効させる。 */
	invalidate(): void {
		const previous = this.controller;
		this.controller = new AbortController();
		previous.abort(
			new Error("Workspace Trustが変更されました。再接続してください。"),
		);
		for (const listener of this.listeners) {
			listener();
		}
	}
	/** UI の表示とセッションの取消しを正本に追従させる。 */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	/** 実体パスを照合し、最も深い登録 root の状態を採用する。 */
	async trusted(path: string): Promise<boolean> {
		if (this.failed || this.pendingRestrictions > 0) {
			return false;
		}
		try {
			const actual = await canonicalPath(path, process.cwd());
			const record = this.list()
				.filter((item) => containsPath(item.root, actual))
				.sort((a, b) => b.root.length - a.root.length)[0];
			return (
				!!record &&
				record.trust === "trusted" &&
				(await sameRootIdentity(record)) &&
				!(await hasNestedRepository(record.root, actual))
			);
		} catch {
			return false;
		}
	}
	/** 外部 root は親が信頼済みでも独立した未信頼の記録にする。 */
	registerExternal(root: string): Promise<void> {
		return this.change(root, false, "external");
	}
	/** キャッシュ全体の信頼では、新しく取得する repo へ許可を継承させない。 */
	async registerExternalCache(root: string): Promise<void> {
		const canonical = await canonicalPath(root, process.cwd());
		if (
			this.records.get(trustKey(canonical))?.origin !== "external-cache"
		) {
			await this.change(canonical, false, "external-cache");
		}
	}
	/** 初めて開いた root を登録し、既存の明示的な信頼を上書きしない。 */
	async registerWorkspace(root: string): Promise<void> {
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
	/** 保存を直列化し、取消しを保存待ちの間も有効にする。 */
	private change(
		root: string,
		trusted: boolean,
		origin?: TrustRecord["origin"],
		expected?: TrustRecord["identity"],
	): Promise<void> {
		if (!trusted) {
			this.pendingRestrictions++;
			this.invalidate();
		}
		const action = this.queue.then(async () => {
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
			this.failed = false;
			if (!trusted) {
				this.pendingRestrictions--;
			}
			const event = trusted ? "user-trusted" : "user-revoked";
			this.audit(registrationEvent(origin, event), canonical);
			this.invalidate();
		});
		this.queue = action.catch(() => {});
		return action;
	}
}

/** 初回の workspace 登録と外部取得を監査で区別する。 */
function registrationEvent(
	origin: TrustRecord["origin"] | undefined,
	fallback: string,
): string {
	if (!origin) {
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
		throw new Error("Trust対象はディレクトリにしてください。");
	}
	const identity = {
		dev: info.dev,
		ino: info.ino,
		birthtimeMs: info.birthtimeMs,
	};
	if (expected && JSON.stringify(identity) !== JSON.stringify(expected)) {
		throw new Error(
			"Trust確認中に対象が変更されました。もう一度確認してください。",
		);
	}
	return identity;
}

/** 同じパスへ再作成された一時リポジトリを以前の信頼で実行しない。 */
async function sameRootIdentity(record: TrustRecord): Promise<boolean> {
	if (
		!record.identity ||
		trustKey(await realpath(record.root)) !== trustKey(record.root)
	) {
		return false;
	}
	const info = await stat(record.root);
	return (
		info.isDirectory() &&
		info.dev === record.identity.dev &&
		info.ino === record.identity.ino &&
		info.birthtimeMs === record.identity.birthtimeMs
	);
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
