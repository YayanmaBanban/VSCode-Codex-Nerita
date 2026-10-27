// 設定した判定器へ必要な操作だけを送り、障害時には人の承認へ戻す。
import { z } from "zod";
import type { AutoReviewRecord } from "@nerita/shared/guardrails/review";
import { createHash, randomUUID } from "node:crypto";
import type { GuardResult } from "@nerita/shared/guardrails/messages";
import type { ToolCall } from "./ApprovedToolCall";
import { autoReviewContext } from "./AutoReviewContext";
import { autoReviewStore, type AutoReviewStore } from "./AutoReviewStore";
import { directReviewFiles } from "./AutoReviewPolicy";
import type { FileSnapshot } from "./FileSnapshot";
import {
	reviewGeneration,
	waitForReview,
	type ReviewUse,
} from "./AutoReviewCache";

export const autoReviewDecisionSchema = z.strictObject({
	outcome: z.enum(["allow", "deny", "ask"]),
	risk: z.enum(["low", "medium", "high", "critical"]),
	authorization: z.enum(["unknown", "low", "medium", "high"]),
	reason: z.string().trim().min(1).max(2000),
});
/** 判定結果は許可の指紋へ含め、別の入力へ転用しない。 */
export type AutoReviewResult = z.infer<typeof autoReviewDecisionSchema> & {
	model: string;
};
/** 手動への差し戻しと、実行内容の再照合に必要な情報。 */
type ReviewResolution = {
	manual: boolean;
	autoReview?: AutoReviewResult;
	reviewFiles?: FileSnapshot[];
};

/** 審査に使う接続・設定と、その世代の取消しシグナルをまとめて取得する。 */
export function reviewSnapshot(
	call: ToolCall,
	store: AutoReviewStore = autoReviewStore,
) {
	const context = autoReviewContext(call);
	if (!context) {
		return undefined;
	}
	return {
		context,
		contextSignal: context.signal,
		...store.snapshot(context.root),
		scope: "",
	};
}
/** 審査中は最新設定に差し替えず、取得した世代だけを使う。 */
type ReviewSnapshot = NonNullable<ReturnType<typeof reviewSnapshot>>;

/** 接続がない場合や手動設定では従来の承認を維持し、自動設定でのみ省略する。 */
export async function reviewToolCall(
	call: ToolCall,
	result: GuardResult,
	snapshot: ReturnType<typeof reviewSnapshot>,
	signal: AbortSignal,
	prefetched = false,
): Promise<ReviewResolution> {
	if (!snapshot || snapshot.config.mode === "manual") {
		return { manual: true };
	}
	const files = await directReviewFiles(call, result);
	signal.throwIfAborted();
	if (files) {
		return { manual: false, reviewFiles: files };
	}
	return runReview(call, result, snapshot, signal, prefetched);
}

/** 判定と履歴を同じ要求へ結び付け、期限切れと拒否を区別する。 */
async function runReview(
	call: ToolCall,
	result: GuardResult,
	snapshot: ReviewSnapshot,
	signal: AbortSignal,
	prefetched: boolean,
): Promise<ReviewResolution> {
	const { config } = snapshot;
	const id = randomUUID();
	const record = reviewReporter(call, snapshot, id, prefetched);
	record("reviewing", "審査中");
	const deadline = AbortSignal.any([
		signal,
		AbortSignal.timeout(config.timeoutMs),
	]);
	try {
		const input = reviewInput(call, result, snapshot);
		const key = reviewKey(call, input, snapshot);
		const use = await snapshot.context.cache.run(
			key,
			id,
			deadline,
			(sharedSignal) =>
				requestReview(
					input,
					snapshot,
					AbortSignal.any([
						sharedSignal,
						snapshot.signal,
						snapshot.contextSignal,
						AbortSignal.timeout(config.timeoutMs),
					]),
				),
			prefetched,
		);
		const { review } = use;
		signal.throwIfAborted();
		const status = {
			allow: "approved",
			deny: "denied",
			ask: "manual",
		} as const;
		record(status[review.outcome], review.reason, use);
		if (review.outcome === "deny") {
			throw new AutoReviewDenied(review.reason);
		}
		return { manual: review.outcome !== "allow", autoReview: review };
	} catch (error) {
		if (error instanceof AutoReviewDenied) {
			throw error;
		}
		record(
			failureStatus(signal, deadline, error),
			"自動レビューを完了できませんでした。",
		);
		signal.throwIfAborted();
		return { manual: true };
	}
}

/** 表示用の操作概要だけをセッションへ渡し、ファイル本文や環境変数の値は永続化しない。 */
function reviewReporter(
	call: ToolCall,
	snapshot: ReviewSnapshot,
	id: string,
	prefetched: boolean,
) {
	const time = Date.now();
	const { context, config } = snapshot;
	const command = call.params.command;
	const path = call.params.path;
	const action = {
		tool: call.tool.slice(0, 300),
		cwd: call.cwd,
		...(typeof command === "string"
			? { command: context.protect(command).slice(0, 8192) }
			: {}),
		...(typeof path === "string"
			? { path: context.protect(path).slice(0, 4096) }
			: {}),
	};
	return (
		status: AutoReviewRecord["status"],
		reason: string,
		use?: ReviewUse,
	) => {
		context.publish?.({
			id,
			time,
			tool: action.tool,
			action,
			status,
			reason: context.protect(reason),
			model: config.model,
			durationMs: Date.now() - time,
			prefetched,
			metrics: context.cache.metrics(),
			...(use
				? {
						risk: use.review.risk,
						authorization: use.review.authorization,
						source: use.source,
						reusedFrom: use.reusedFrom,
						reviewDurationMs: use.reviewDurationMs,
					}
				: {}),
		});
	};
}

/** 正確な操作と出所を保った証拠だけを送り、不完全な入力を推測で自動承認しない。 */
function reviewInput(
	call: ToolCall,
	result: GuardResult,
	snapshot: ReviewSnapshot,
) {
	const { context, config } = snapshot;
	const evidence = context.evidence();
	if (!evidence.some((item) => item.role === "user")) {
		throw new Error("ユーザーの依頼を確認できません。");
	}
	const { env: _env, ...params } = call.params;
	const input = context.protect(
		JSON.stringify({
			evidence,
			action: {
				tool: call.tool,
				params,
				command: call.command,
				cwd: call.cwd,
				policy: call.policy,
				sandbox: call.sandbox,
				hostShell: call.hostShell,
				envKeys: Object.keys(call.env ?? {}),
				file: call.file,
			},
			guardrails: result,
		}),
	);
	if (input.length > 65536 || config.model === "") {
		throw new Error(
			"レビューの入力が65536文字を超えているか、モデルが未指定です。",
		);
	}
	return input;
}

/** 外部状態に依存するシェルや拡張は対象外とし、秘匿前の正確な引数も指紋へ含める。 */
function reviewKey(call: ToolCall, input: string, snapshot: ReviewSnapshot) {
	if (!call.file || !["write", "edit"].includes(call.tool)) {
		return undefined;
	}
	return createHash("sha256")
		.update(
			JSON.stringify({
				call,
				input,
				config: snapshot.config,
				scope: snapshot.scope,
				generation: reviewGeneration(snapshot.signal),
			}),
		)
		.digest("hex");
}

/** 共有する推論には呼出し元ごとの Stop を直接渡さず、最後の待機者の取消しを使う。 */
async function requestReview(
	input: string,
	snapshot: ReviewSnapshot,
	signal: AbortSignal,
): Promise<AutoReviewResult> {
	const { context, config } = snapshot;
	const response = await waitForReview(
		context.review(config, input, signal),
		signal,
	);
	signal.throwIfAborted();
	const parsed = autoReviewDecisionSchema.parse(
		typeof response === "string" ? JSON.parse(response) : response,
	);
	const unauthorizedHigh =
		parsed.risk === "high" &&
		!["medium", "high"].includes(parsed.authorization);
	if (parsed.risk === "critical" || unauthorizedHigh) {
		parsed.outcome = "deny";
	}
	return {
		...parsed,
		reason: context.protect(parsed.reason),
		model: config.model,
	};
}

/** 判定不能と拒否を区別し、明示的な拒否を障害時の手動承認へ変えない。 */
export class AutoReviewDenied extends Error {
	/** 審査の拒否を通常の実行エラーと区別し、別経路による回避を指示しない。 */
	constructor(reason: string) {
		super(
			`自動レビューが実行を拒否しました: ${reason}\n同じ操作を別経路で実行せず、安全な代替手段を選ぶかユーザーに確認してください。`,
		);
	}
}

/** 中断と時間切れを個別に表示し、どちらでも自動実行はしない。 */
function failureStatus(
	signal: AbortSignal,
	deadline: AbortSignal,
	error: unknown,
): AutoReviewRecord["status"] {
	if (signal.aborted) {
		return "cancelled";
	}
	const timedOut =
		deadline.aborted ||
		(error instanceof Error && error.name === "TimeoutError");
	return timedOut ? "timedOut" : "unavailable";
}
