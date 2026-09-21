// promptの受付と実行を分け、開始直前のStop・旧接続の完了を安全に扱う。
import { randomUUID } from "node:crypto";
import type { UiMessage } from "../../../shared/messages";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { PiLifecycle } from "./PiLifecycle";
import { PiEventMapper } from "./PiEventMapper";
import { finishPiTools } from "./PiToolMapper";
import { Approvals } from "../../session/Approvals";
import type { PiAuthorize } from "./PiApprovedTools";

/** SDK送信の受付状態とイベント購読を保持する。 */
type Submission = {
	id: string;
	cancelled: boolean;
	accepted: boolean;
	unsubscribe: () => void;
	abort: AbortController;
};

/** 最小版では同時送信を拒否し、Stop後に同じセッションを継続できる。 */
export abstract class PiRun extends PiLifecycle {
	private submission: Submission | undefined;
	protected readonly approvals = new Approvals(() =>
		this.patch({ permissions: this.approvals.list() }),
	);

	/** 拒否はツールエラーとして返し、中止はターン全体を停止する。 */
	protected authorize: PiAuthorize = async (title, signal) => {
		const submission = this.submission;
		if (!submission || submission.cancelled) {
			throw new Error("実行中のPi会話がありません。");
		}
		const { decision } = await this.approvals.ask(title, [
			submission.abort.signal,
			...(signal ? [signal] : []),
		]);
		if (decision === "cancel" && this.submission === submission) {
			this.cancel();
		}
		submission.abort.signal.throwIfAborted();
		signal?.throwIfAborted();
		if (decision !== "accept") {
			throw new Error(
				"ユーザーが実行を拒否しました。操作は実行されていません。",
			);
		}
		return submission.abort.signal;
	};

	/** SDKの事前検証が終わった時点でComposerの下書きを解放する。 */
	protected submit(
		message: Extract<UiMessage, { type: "prompt/send" }>,
	): void {
		const runtime = this.runtime;
		if (!runtime || this.busy() || this.state.sessionPending) {
			throw new Error(
				"Piの実行が終わってから送信してください。追加指示は後続対応です。",
			);
		}
		if (
			message.referencedSessionIds?.length ||
			message.changeScopes?.length
		) {
			throw new Error(
				"Piの最小版では会話参照・変更点の添付には対応していません。",
			);
		}
		const epoch = this.epoch;
		const submission: Submission = {
			id: randomUUID(),
			cancelled: false,
			accepted: false,
			unsubscribe: () => {},
			abort: new AbortController(),
		};
		this.submission = submission;
		const current = () =>
			this.epoch === epoch && this.submission === submission;
		const mapper = new PiEventMapper();
		submission.unsubscribe = runtime.subscribe((event) => {
			if (!current()) {
				return;
			}
			const patch = mapper.apply(event, this.state);
			if (patch) {
				this.patch(patch);
			}
		});
		this.patch({ run: "running", runId: submission.id, error: null });
		const operation = runtime
			.prompt(message.text, {
				expandPromptTemplates: false,
				preflightResult: (accepted) => {
					if (!current() || submission.cancelled) {
						throw new Error("送信を停止しました。");
					}
					if (accepted) {
						submission.accepted = true;
						this.patch({
							messages: [
								...this.state.messages,
								{
									id: randomUUID(),
									role: "user",
									text: message.text,
									order: nextTimelineOrder(this.state),
								},
							],
						});
						this.emit({
							type: "prompt/accepted",
							requestId: message.requestId,
							mode: "start",
						});
					}
				},
			})
			.then(
				() => {
					if (current()) {
						this.finish(submission, mapper.error, mapper.aborted);
					}
				},
				(error: unknown) => {
					if (current()) {
						const detail =
							error instanceof Error
								? error.message
								: "Piへの送信に失敗しました。";
						if (!submission.accepted) {
							this.emit({
								type: "request/failed",
								requestId: message.requestId,
								error: detail,
							});
						}
						this.finish(submission, detail);
					}
				},
			)
			.finally(() => submission.unsubscribe());
		this.track(operation);
	}

	/** SDKのpromptが終了するまでrunningを維持し、tool間のturn_endでは完了しない。 */
	private finish(
		submission: Submission,
		error?: string,
		aborted = false,
	): void {
		const cancelled = submission.cancelled || aborted;
		this.submission = undefined;
		submission.abort.abort();
		this.patch({
			run: cancelled ? "cancelled" : error ? "failed" : "completed",
			error: cancelled ? null : (error ?? null),
			tools: finishPiTools(this.state, cancelled, error),
			messages: this.state.messages.map((message) => ({
				...message,
				streaming: false,
			})),
		});
	}

	/** 実行前ならpreflightで遮断し、実行中ならSDKのabortへ渡す。 */
	protected cancel(): void {
		const submission = this.submission;
		const runtime = this.runtime;
		if (!submission || !runtime || submission.cancelled) {
			return;
		}
		submission.cancelled = true;
		submission.abort.abort();
		this.patch({ run: "cancelling" });
		this.track(
			runtime.abort().catch(() => {
				if (this.submission === submission) {
					this.invalidate();
					this.patch({
						connection: "error",
						error: "Piを停止できませんでした。再接続してください。",
					});
				}
			}),
		);
	}

	/** 遅れて完了する事前検証も、古い会話へ送信できない状態にする。 */
	protected override resetRun(): void {
		if (this.submission) {
			this.submission.cancelled = true;
			this.submission.abort.abort();
			this.submission.unsubscribe();
			this.submission = undefined;
		}
	}
}
