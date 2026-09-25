// 任意の外部判定を承認前に挟み、障害や設定変更で許可を緩めない。
import { z } from "zod";
import { freezeToolCall, type ToolCall } from "./ApprovedToolCall";

/** 外部へ送る項目を限定し、コマンド・パス・本文・環境変数を含めない。 */
export type JevReviewInput = {
	tool: string;
	action: string;
	arguments_summary: string[];
	side_effects: string[];
	safeguards: string[];
	policy: string[];
};
export const jevDecisionSchema = z.object({
	decision: z.enum(["allow", "confirm", "review", "deny"]),
	guidance: z.string().trim().min(1).max(2000),
});
/** 外部の判定は実行許可ではなく、承認表示と拒否の材料にする。 */
export type JevReviewResult = z.infer<typeof jevDecisionSchema> & {
	status: "reviewed" | "unavailable";
};
/** 認証情報はアダプターの閉包に保持し、入力や承認対象に含めない。 */
export type JevReviewer = (
	input: JevReviewInput,
	signal: AbortSignal,
) => Promise<unknown>;

/** Host が設定する接続口。既定は未接続で、設定ファイルから有効化しない。 */
export class JevGuard {
	private reviewer: JevReviewer | undefined;
	private generation = new AbortController();

	/** 接続変更で古い判定待ち・承認・実行許可を取り消す。 */
	configure(reviewer?: JevReviewer): void {
		this.generation.abort(
			new Error("Jevの接続設定が変更されました。再承認が必要です。"),
		);
		this.generation = new AbortController();
		this.reviewer = reviewer;
	}

	/** 接続と取消し世代を一緒に固定し、承認途中の差し替えを防ぐ。 */
	snapshot() {
		return { reviewer: this.reviewer, signal: this.generation.signal };
	}
}
export const jevGuard = new JevGuard();

/** 決定論的な検査を通過した承認対象だけを審査し、拒否を許可へ変えない。 */
export async function reviewJevIfNeeded(
	reviewer: JevReviewer | undefined,
	needsApproval: boolean,
	call: ToolCall,
	signal: AbortSignal,
): Promise<{ jevReview?: JevReviewResult }> {
	if (!needsApproval || !reviewer) {
		return {};
	}
	const jevReview = await reviewWithJev(reviewer, call, signal);
	if (jevReview.decision === "deny") {
		throw new Error(`Jevが実行を拒否しました: ${jevReview.guidance}`);
	}
	return { jevReview };
}

/** 詳細情報を送信する同意と要約方式が整うまでは、構造だけを送る。 */
export function summarizeJevCall(call: ToolCall): JevReviewInput {
	const tool = [
		"read",
		"ls",
		"write",
		"edit",
		"powershell",
		"pwsh",
		"bash",
	].includes(call.tool)
		? call.tool
		: "extension";
	return freezeToolCall({
		tool,
		action: `Review a ${tool} tool invocation before human approval`,
		arguments_summary: [
			`argument_count=${Object.keys(call.params).length}`,
			`command_present=${Boolean(call.command || call.hostShell)}`,
			"Argument values, paths, contents and user intent are withheld",
		],
		side_effects: [
			"File, process and network effects are not semantically verified",
		],
		safeguards: [
			"Local deterministic guard completed",
			"Execution remains subject to local policy",
		],
		policy: [
			"Human approval is required regardless of an allow result",
			"Reversibility is unknown",
		],
	});
}

/** 応答形式違反・通信失敗・時間切れは人の確認へ戻し、Stop は中断する。 */
export async function reviewWithJev(
	reviewer: JevReviewer,
	call: ToolCall,
	signal: AbortSignal,
	timeoutMs = 8000,
): Promise<JevReviewResult> {
	signal.throwIfAborted();
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
	let abort: () => void = () => {};
	try {
		const cancelled = new Promise<never>((_resolve, reject) => {
			abort = () => reject(new Error("Jev review interrupted"));
			deadline.addEventListener("abort", abort, { once: true });
			if (deadline.aborted) {
				abort();
			}
		});
		const response = await Promise.race([
			cancelled,
			Promise.resolve().then(() => {
				deadline.throwIfAborted();
				return reviewer(summarizeJevCall(call), deadline);
			}),
		]);
		signal.throwIfAborted();
		return { ...jevDecisionSchema.parse(response), status: "reviewed" };
	} catch {
		signal.throwIfAborted();
		return {
			status: "unavailable",
			decision: "confirm",
			guidance:
				"Jevの判定を取得できませんでした。操作内容を確認して承認してください。",
		};
	} finally {
		deadline.removeEventListener("abort", abort);
	}
}
