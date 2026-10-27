// 同一条件の審査だけを共有し、実行許可を保持せず、低リスク判定を短時間だけ再利用する。
import type { AutoReviewResult } from "./AutoReviewGuard";
import { randomUUID } from "node:crypto";

const generations = new WeakMap<AbortSignal, string>();

/** 設定値が同じでも、信頼・ルール・設定の再適用を別の審査世代として扱う。 */
export function reviewGeneration(signal: AbortSignal) {
	let id = generations.get(signal);
	if (id === undefined) {
		id = randomUUID();
		generations.set(signal, id);
	}
	return id;
}

/** 審査の出所と元の表示記録を保持し、再利用を新しいモデル推論と区別する。 */
export type ReviewUse = {
	review: AutoReviewResult;
	source: "model" | "shared" | "cache" | "prefetch";
	reusedFrom?: string;
	reviewDurationMs: number;
};
/** 中断は待機者ごとに扱い、全員が離れた場合だけ共有中のモデル要求を止める。 */
type Entry = {
	id: string;
	abort: AbortController;
	promise: Promise<AutoReviewResult>;
	waiters: number;
	started: number;
	duration: number;
	value?: AutoReviewResult;
	handoff: boolean;
};

/** キャッシュは親セッションのメモリー内に保持し、接続終了・入力更新・停止時に破棄する。 */
export class AutoReviewCache {
	private readonly entries = new Map<string, Entry>();
	private readonly active = new Set<Entry>();
	private readonly counts = {
		requests: 0,
		modelCalls: 0,
		shared: 0,
		hits: 0,
		prefetches: 0,
		unusedPrefetches: 0,
	};

	/** キーを作れない操作は常に審査し、確定済みファイル操作だけを共有する。 */
	async run(
		key: string | undefined,
		id: string,
		signal: AbortSignal,
		load: (signal: AbortSignal) => Promise<AutoReviewResult>,
		prefetched = false,
	): Promise<ReviewUse> {
		signal.throwIfAborted();
		if (prefetched) {
			this.counts.prefetches++;
		} else {
			this.counts.requests++;
		}
		this.prune();
		const { entry, source } = this.acquire(key, id, load, prefetched);
		if (entry.value) {
			return this.result(entry, entry.value, source);
		}
		entry.waiters++;
		try {
			const review = await waitForReview(entry.promise, signal);
			return this.result(entry, review, source);
		} finally {
			this.release(key, entry);
		}
	}

	/** 判定結果を保持しておらず、待機者もいなくなった要求だけを中断する。 */
	private release(key: string | undefined, entry: Entry) {
		entry.waiters--;
		if (entry.waiters === 0 && !entry.value) {
			entry.abort.abort();
			this.remove(key, entry);
		}
	}

	/** 完了済みと進行中を区別し、先読み結果は実行側へ一度だけ引き渡す。 */
	private acquire(
		key: string | undefined,
		id: string,
		load: (signal: AbortSignal) => Promise<AutoReviewResult>,
		prefetched: boolean,
	): { entry: Entry; source: ReviewUse["source"] } {
		const entry = key === undefined ? undefined : this.entries.get(key);
		if (!entry) {
			return {
				entry: this.start(key, id, load, prefetched),
				source: "model",
			};
		}
		let source: ReviewUse["source"] = "shared";
		if (entry.value) {
			this.counts.hits++;
			source = "cache";
		} else {
			this.counts.shared++;
		}
		if (entry.handoff && !prefetched) {
			entry.handoff = false;
			source = "prefetch";
		}
		if (entry.value && !reusable(entry.value)) {
			this.remove(key, entry);
		}
		return { entry, source };
	}

	/** 判定自体の時間と、この要求が待った時間を混同しない。 */
	private result(
		entry: Entry,
		review: AutoReviewResult,
		source: ReviewUse["source"],
	): ReviewUse {
		return {
			review,
			source,
			...(source !== "model" ? { reusedFrom: entry.id } : {}),
			reviewDurationMs: entry.duration,
		};
	}

	/** 表示用履歴とは別に集計し、キャッシュの効果をモデル呼出し数で確認する。 */
	metrics() {
		return { ...this.counts };
	}

	/** Stop・入力更新・接続終了では進行中と完了済みの判定を同時に失効させる。 */
	clear() {
		for (const entry of this.active) {
			entry.abort.abort();
		}
		for (const entry of this.entries.values()) {
			if (entry.handoff) {
				this.counts.unusedPrefetches++;
			}
		}
		this.entries.clear();
	}

	/** 継続的な再利用には `low` かつ `allow` だけを残す。先読みの判定は1回の引き渡しまで保持し、障害は残さない。 */
	private start(
		key: string | undefined,
		id: string,
		load: (signal: AbortSignal) => Promise<AutoReviewResult>,
		prefetched: boolean,
	) {
		this.counts.modelCalls++;
		const entry: Entry = {
			id,
			abort: new AbortController(),
			promise: Promise.resolve().then(() => load(entry.abort.signal)),
			waiters: 0,
			started: Date.now(),
			duration: 0,
			handoff: prefetched,
		};
		this.active.add(entry);
		if (key !== undefined) {
			this.entries.set(key, entry);
		}
		entry.promise = entry.promise
			.then((review) => {
				entry.abort.signal.throwIfAborted();
				entry.duration = Date.now() - entry.started;
				if (entry.handoff || reusable(review)) {
					entry.value = review;
				} else {
					this.remove(key, entry);
				}
				return review;
			})
			.catch((error: unknown) => {
				this.remove(key, entry);
				throw error;
			})
			.finally(() => {
				this.active.delete(entry);
			});
		return entry;
	}

	/** 遅い旧要求の完了によって、同じキーの新しい要求を消さない。 */
	private remove(key: string | undefined, entry: Entry) {
		if (key !== undefined && this.entries.get(key) === entry) {
			this.entries.delete(key);
		}
	}

	/** 完了済みだけを削除し、進行中の要求を追い出して重複送信しない。 */
	private prune() {
		for (const [key, entry] of this.entries) {
			if (entry.value && Date.now() - entry.started > 30000) {
				this.expire(key, entry);
			}
		}
		for (const [key, entry] of this.entries) {
			if (this.entries.size < 32) {
				break;
			}
			if (entry.value) {
				this.expire(key, entry);
			}
		}
	}
	/** 使われなかった先読みの件数を残し、費用だけが増えていないか判断できるようにする。 */
	private expire(key: string, entry: Entry) {
		if (entry.handoff) {
			this.counts.unusedPrefetches++;
		}
		this.entries.delete(key);
	}
}

/** 継続的な再利用と、先読み結果の一度限りの引き渡しを区別する。 */
function reusable(review: AutoReviewResult) {
	return review.outcome === "allow" && review.risk === "low";
}

/** 通信先が中断を無視した場合も待機を終了し、遅い結果から許可を発行しない。 */
export async function waitForReview<T>(
	review: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	/** finally から解除できるよう、中断通知の参照を保持する。 */
	let abort = () => {};
	try {
		return await Promise.race([
			review,
			new Promise<never>((_resolve, reject) => {
				abort = () => {
					const reason: unknown = signal.reason;
					reject(
						reason instanceof Error
							? reason
							: new Error("自動レビューが中断されました。"),
					);
				};
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) {
					abort();
				}
			}),
		]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}
