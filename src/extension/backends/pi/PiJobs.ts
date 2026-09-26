// 子の待機列・承認・取消しを親の応答期間から分離し、表示用の結果を保存する。
import { z } from "zod";
import type {
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { PiAgentViews } from "./PiAgentViews";
import type { ToolAuthorizer } from "../../security/ApprovalGuard";

const jobSchema = z.object({
	id: z.string(),
	parentId: z.string(),
	status: z.enum([
		"queued",
		"running",
		"approval",
		"completed",
		"failed",
		"cancelled",
		"interrupted",
	]),
	background: z.boolean(),
	context: z.enum(["fresh", "fork"]),
	result: z.string().max(32768).optional(),
});
/** 再接続後は表示専用となり、処理や承認を自動再開しない。 */
export type PiJob = z.infer<typeof jobSchema>;
/** 実行中だけが保持する取消しと完了待機。 */
type ActiveJob = { abort: AbortController; done: Promise<unknown> };
const activeStates = new Set(["queued", "running", "approval"]);

/** 同時実行枠には承認待ちも含め、待機列の起動前にも取消しを検査する。 */
export class PiJobs {
	private records = new Map<string, PiJob>();
	private active = new Map<string, ActiveJob>();
	private running = 0;
	private wake = new Set<() => void>();
	private stopping = false;
	constructor(
		private views: PiAgentViews,
		private manager?: Pick<SessionManager, "appendCustomEntry">,
	) {}

	/** 選択ブランチだけを復元し、別の親へフォークした場合も関連を更新する。 */
	restore(entries: SessionEntry[], parentId: string) {
		for (const entry of entries) {
			if (
				entry.type !== "custom" ||
				entry.customType !== "nerita.job.v1"
			) {
				continue;
			}
			const record = jobSchema.parse(entry.data);
			if (activeStates.has(record.status)) {
				record.status = "interrupted";
			}
			this.records.set(record.id, record);
			if (this.records.size > 128) {
				throw new Error("ジョブ履歴の上限を超えています。");
			}
		}
		for (const record of this.records.values()) {
			if (!this.records.has(record.parentId)) {
				record.parentId = parentId;
			}
		}
	}

	/** 受付時点の実行条件を閉じ込め、背景実行でも失敗を必ず回収する。 */
	submit<T>(
		record: PiJob,
		signal: AbortSignal,
		run: (signal: AbortSignal) => Promise<T>,
		useSlot = true,
	): Promise<T> {
		if (
			this.stopping ||
			this.records.has(record.id) ||
			this.records.size >= 128
		) {
			throw new Error("ジョブを受け付けられません。");
		}
		signal.throwIfAborted();
		const abort = new AbortController();
		const combined = AbortSignal.any([signal, abort.signal]);
		this.records.set(record.id, { ...record });
		this.update(record.id, "queued");
		const done = this.execute(record.id, combined, run, useSlot).finally(
			() => this.active.delete(record.id),
		);
		this.active.set(record.id, { abort, done });
		void done.catch(() => undefined);
		return done;
	}

	/** 実行枠は結果保存と子の回収が終わってから解放する。 */
	private async execute<T>(
		id: string,
		signal: AbortSignal,
		run: (signal: AbortSignal) => Promise<T>,
		useSlot: boolean,
	): Promise<T> {
		let acquired = false;
		try {
			if (useSlot) {
				await this.acquire(signal);
				acquired = true;
			}
			signal.throwIfAborted();
			this.update(id, "running");
			const result = await run(signal);
			signal.throwIfAborted();
			this.update(
				id,
				"completed",
				JSON.stringify(result).slice(0, 32768),
			);
			return result;
		} catch (error) {
			this.update(
				id,
				signal.aborted ? "cancelled" : "failed",
				String(error).slice(0, 32768),
			);
			throw error;
		} finally {
			if (acquired) {
				this.running--;
			}
			for (const wake of this.wake) {
				wake();
			}
		}
	}

	/** 待機中の取消しでもリスナーを残さず終了する。 */
	private async acquire(signal: AbortSignal) {
		while (this.running >= 4) {
			signal.throwIfAborted();
			await new Promise<void>((resolve) => {
				const wake = () => {
					this.wake.delete(wake);
					signal.removeEventListener("abort", wake);
					resolve();
				};
				this.wake.add(wake);
				signal.addEventListener("abort", wake, { once: true });
			});
		}
		signal.throwIfAborted();
		this.running++;
	}

	/** 起動承認と子の操作承認の双方をジョブの状態に反映する。 */
	authorizer(id: string, authorize: ToolAuthorizer): ToolAuthorizer {
		return async (presentation, signal) => {
			this.update(id, "approval");
			const title =
				typeof presentation === "string"
					? { title: presentation }
					: presentation;
			try {
				return await authorize(
					{
						...title,
						fields: [
							...(title.fields ?? []),
							{
								id: "subagent-job",
								label: "ジョブ",
								value: id,
								display: "text",
							},
						],
					},
					signal,
				);
			} finally {
				this.update(id, "running");
			}
		};
	}

	/** 保存先と Viewer の表示を同じ状態遷移から更新する。 */
	private update(id: string, status: PiJob["status"], result?: string) {
		const record = this.records.get(id)!;
		record.status = status;
		if (result !== undefined) {
			record.result = result;
		}
		const states = {
			queued: "pendingInit",
			running: "running",
			approval: "running",
			completed: "completed",
			failed: "errored",
			cancelled: "interrupted",
			interrupted: "interrupted",
		} as const;
		const labels = {
			queued: "起動待ち",
			running: "実行中",
			approval: "承認待ち",
			completed: "完了",
			failed: "失敗",
			cancelled: "取消し",
			interrupted: "中断",
		};
		this.views.status(id, states[status], labels[status]);
		this.manager?.appendCustomEntry(
			"nerita.job.v1",
			structuredClone(record),
		);
	}

	/** 現在の親に所属するジョブだけを返す。 */
	list() {
		return structuredClone([...this.records.values()]);
	}
	/** 未知の ID を別セッションやファイルの探索に使わない。 */
	read(id: string) {
		const record = this.records.get(id);
		if (!record) {
			throw new Error("この会話にジョブがありません。");
		}
		return structuredClone(record);
	}
	/** 個別取消しは終了済みの履歴を変更しない。 */
	async cancel(id: string) {
		this.read(id);
		const active = this.active.get(id);
		active?.abort.abort();
		await active?.done.catch(() => undefined);
	}
	/** 起動待ちも先に失効させ、全ジョブの回収を待つ。 */
	async stop() {
		this.stopping = true;
		try {
			const jobs = [...this.active.values()];
			for (const job of jobs) {
				job.abort.abort();
			}
			await Promise.allSettled(jobs.map((job) => job.done));
		} finally {
			this.stopping = false;
		}
	}
}
