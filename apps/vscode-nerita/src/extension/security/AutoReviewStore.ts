// 利用者が明示的に保存したレビュー設定を保持し、変更時に以前の実行許可を失効させる。
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	autoReviewConfigSchema,
	defaultAutoReview,
	type AutoReviewConfig,
} from "@nerita/shared/agentManager/autoReview";
import { freezeToolCall } from "./ApprovedToolCall";

/** VS Code の信頼済み保存領域のみを受け取り、ファイルからの自動適用を防ぐ。 */
export type AutoReviewStorage = {
	get(key: string): unknown;
	update(key: string, value: unknown): PromiseLike<void>;
};
/** 設定世代の取消しを、承認待ちと実行中の許可へ伝える。 */
type Entry = {
	config: AutoReviewConfig;
	abort: AbortController;
};

/** 保存の成功後にだけ実効設定を変更する。 */
export class AutoReviewStore {
	private readonly entries = new Map<string, Entry>();
	private storage: AutoReviewStorage | undefined;

	/** 起動時に接続し、実行中の接続差し替えでは既存の許可を取り消す。 */
	connect(storage: AutoReviewStorage) {
		for (const entry of this.entries.values()) {
			entry.abort.abort();
		}
		this.entries.clear();
		this.storage = storage;
	}
	/** 未保存は手動承認とし、不正な保存値から自動実行を開始しない。 */
	snapshot(root: string) {
		const key = resolve(root);
		let entry = this.entries.get(key);
		if (!entry) {
			const stored = this.storage?.get(storageKey(key));
			const parsed = autoReviewConfigSchema.safeParse(stored);
			entry = {
				config: freezeToolCall(
					parsed.success ? parsed.data : defaultAutoReview(),
				),
				abort: new AbortController(),
			};
			this.entries.set(key, entry);
		}
		return {
			config: entry.config,
			signal: entry.abort.signal,
		};
	}
	/** 設定を再検証して保存し、以前の承認待ちと許可を失効させる。 */
	async save(root: string, config: AutoReviewConfig) {
		const next = freezeToolCall(autoReviewConfigSchema.parse(config));
		const key = resolve(root);
		this.snapshot(key);
		await this.storage?.update(storageKey(key), next);
		const entry = this.entries.get(key)!;
		entry.abort.abort(
			new Error("自動レビュー設定が変更されました。再承認が必要です。"),
		);
		this.entries.set(key, {
			config: next,
			abort: new AbortController(),
		});
	}
}

/** 保存キーへ生のパスを埋め込まず、ワークスペースごとに設定を分ける。 */
function storageKey(root: string) {
	return `nerita.autoReview.${createHash("sha256").update(root).digest("hex")}`;
}

export const autoReviewStore = new AutoReviewStore();
