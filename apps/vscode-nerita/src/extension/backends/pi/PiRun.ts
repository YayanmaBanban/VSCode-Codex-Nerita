// `prompt` の受付と実行を分け、開始直前の停止や旧接続の完了が現在の実行に反映されるのを防ぐ。

import type { ChatState } from "@nerita/shared/chatState";

import { realpath } from "node:fs/promises";
import type { WorkflowExecution } from "@nerita/shared/workflows/messages";
import { randomUUID } from "node:crypto";
import type { UiMessage } from "@nerita/shared/messages";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { PiLifecycle } from "./PiLifecycle";
import { PiEventMapper } from "./PiEventMapper";
import { finishPiTools } from "./PiToolMapper";
import { PiPermissions } from "./PiPermissions";
import type { PiAuthorize } from "./PiApprovedTools";
import { piPromptContext } from "./PiPromptContext";
import { setPiSessionRunning } from "./PiSessionActivity";

import { type PiSession } from "./PiRuntime";

/** SDK 送信の受付状態とイベント購読を保持する。 */
type Submission = {
	id: string;
	cancelled: boolean;
	accepted: boolean;
	unsubscribe: () => void;
	abort: AbortController;
	ended: boolean;
	steering?: Promise<void>;
};

/** 通常送信と追加指示を同じ実行に結び付け、停止・完了との競合を遮断する。 */
export abstract class PiRun extends PiLifecycle {
	private submission: Submission | undefined;
	protected readonly approvals = new PiPermissions(() =>
		this.patch({ permissions: this.approvals.list() }),
	);

	/** 接続中の会話に属する承認ストアだけを使う。 */
	private get commandPermissions() {
		return this.runtime?.commandPermissions;
	}

	/** 拒否はツールエラーとして返し、中止はターン全体を停止する。 */
	protected authorize: PiAuthorize = async (title, signal) => {
		const commandPermissions = this.commandPermissions;
		const jobId =
			typeof title === "string"
				? undefined
				: title.fields?.find((field) => field.id === "subagent-job")
						?.value;
		if (jobId && signal && this.runtime?.jobs) {
			const jobs = this.runtime.jobs;
			jobs.read(jobId);
			return this.approvals.authorize(
				title,
				{
					signal,
					cancel: () => {
						void jobs.cancel(jobId);
					},
				},
				signal,
				commandPermissions,
			);
		}
		const submission = this.submission;
		if (!submission || submission.cancelled) {
			throw new Error("実行中のPi会話がありません。");
		}
		return this.approvals.authorize(
			title,
			{
				signal: submission.abort.signal,
				cancel: () => {
					if (this.submission === submission) {
						this.cancel();
					}
				},
			},
			signal,
			commandPermissions,
		);
	};

	/** 文書と同じルートの会話だけを使い、親モデルへの送信なしで子を起動する。 */
	async workflow(request: WorkflowExecution, signal: AbortSignal) {
		const runtime = this.runtime;
		if (
			!runtime?.workflow ||
			this.state.connection !== "ready" ||
			this.state.sessionPending ||
			this.state.configPending
		) {
			throw new Error("Pi への接続とモデル設定を完了してください。");
		}
		if (
			!this.state.cwd ||
			(await realpath(this.state.cwd)) !== request.root
		) {
			throw new Error(
				"Workflow と同じワークスペースの Pi 会話を開いてください。",
			);
		}
		if (this.runtime !== runtime) {
			throw new Error("Pi の接続が変更されました。");
		}
		const abort = new AbortController();
		const combined = AbortSignal.any([
			signal,
			abort.signal,
			this.connectionSignal,
		]);
		this.patch({ runId: this.state.runId ?? randomUUID() });
		const operation = runtime.workflow(
			request,
			combined,
			(title, toolSignal) =>
				this.approvals.authorize(
					title,
					{ signal: combined, cancel: () => abort.abort() },
					toolSignal,
					this.runtime?.commandPermissions,
				),
		);
		this.track(operation);
		return operation;
	}
	/** SDK の事前検証が終わった時点で送信受付を通知し、入力欄の下書きを消せるようにする。 */
	protected submit(
		message: Extract<UiMessage, { type: "prompt/send" }>,
	): void {
		const runtime = this.runtime;
		if (!runtime || this.state.sessionPending) {
			throw new Error("Piへ接続してから送信してください。");
		}
		if (message.changeScopes?.length) {
			throw new Error("Piの最小版では変更点の添付には対応していません。");
		}
		if (this.submission) {
			this.steer(message, this.submission);
			return;
		}
		const epoch = this.epoch;
		const submission: Submission = {
			id: randomUUID(),
			cancelled: false,
			accepted: false,
			unsubscribe: () => {},
			abort: new AbortController(),
			ended: false,
		};
		this.submission = submission;
		setPiSessionRunning(runtime.sessionId, true);
		const current = () =>
			this.epoch === epoch && this.submission === submission;
		const mapper = new PiEventMapper();
		const unsubscribeEvents = runtime.subscribe(
			this.createRunEventListener(current, mapper),
		);
		submission.unsubscribe = () => {
			unsubscribeEvents();
		};
		this.patch({ run: "running", runId: submission.id, error: null });
		const start = this.createPromptStarter(
			runtime,
			current,
			submission,
			message,
		);
		const check = () => {
			if (!current() || submission.cancelled) {
				throw new Error("送信を停止しました。");
			}
		};

		const input =
			message.codeReferences?.length || message.sessionReferences?.length
				? piPromptContext(
						runtime,
						this.state.cwd!,
						message,
						submission.abort.signal,
						check,
					).then(start)
				: start(message.text);

		this.trackSubmission(input, submission, mapper, current, message);
	}

	/** 現在の親へ子のカードを追加し、以後は表示順を固定する。 */
	protected override watchSessionAgents(runtime: PiSession) {
		return (
			runtime.agentViews?.subscribe(() => {
				if (this.runtime !== runtime) {
					return;
				}
				const agents = runtime
					.agentViews!.list()
					.map(this.createAgentTimelineEntry());
				this.patch({ agents });
			}) ?? (() => {})
		);
	}

	/** SDK の非同期の入力処理中は次の送信を拒否し、遅れて積まれたキューを回収する。 */
	private steer(
		message: Extract<UiMessage, { type: "prompt/send" }>,
		submission: Submission,
	): void {
		const runtime = this.runtime!;
		if (
			!submission.accepted ||
			submission.cancelled ||
			submission.ended ||
			submission.steering ||
			!runtime.isStreaming
		) {
			throw new Error(
				"Piの送信・停止処理が終わってから再送してください。",
			);
		}
		const epoch = this.epoch;
		const operation = Promise.resolve().then(async () => {
			try {
				if (this.staleSubmission(submission, epoch)) {
					throw new Error(
						"追加指示の対象の実行は終了しました。再送してください。",
					);
				}

				const text = await piPromptContext(
					runtime,
					this.state.cwd!,
					message,
					submission.abort.signal,
					() => {
						if (this.staleSubmission(submission, epoch)) {
							throw new Error(
								"追加指示の対象の実行は終了しました。再送してください。",
							);
						}
					},
				);
				const disposition = await runtime.steer(text);
				if (disposition === "handled") {
					// 実行が直後に終わっても、拡張が引き受けた入力を再送させない。
					if (this.epoch !== epoch) {
						return;
					}
					if (submission.cancelled) {
						throw new Error("追加指示の受付を停止しました。");
					}
					this.emit({
						type: "prompt/accepted",
						requestId: message.requestId,
						mode: "steer",
					});
					return;
				}

				if (
					this.staleSubmission(submission, epoch) ||
					!runtime.isStreaming
				) {
					runtime.clearQueue();
					throw new Error(
						"追加指示の対象の実行は終了しました。再送してください。",
					);
				}
				this.appendUserMessage(message);
				this.emit({
					type: "prompt/accepted",
					requestId: message.requestId,
					mode: "steer",
				});
			} catch (error) {
				this.rejectSteer(submission, epoch, runtime, message, error);
			} finally {
				delete submission.steering;
			}
		});
		submission.steering = operation;
		this.track(operation);
	}

	/** 通常送信またはキュー登録された入力だけを会話本文へ追加する。 */
	private appendUserMessage(
		message: Extract<UiMessage, { type: "prompt/send" }>,
	) {
		this.patch({
			messages: [
				...this.state.messages,
				{
					id: randomUUID(),
					role: "user",
					text: message.text,
					references: message.references ?? [],
					order: nextTimelineOrder(this.state),
				},
			],
		});
	}

	/** 停止・完了または接続変更で追加指示が無効になったか確認する。 */
	private staleSubmission(submission: Submission, epoch: number) {
		return submission.cancelled || submission.ended || this.epoch !== epoch;
	}

	/** 追加指示の失敗時に古いキューを回収して通知する。 */
	private rejectSteer(
		submission: Submission,
		epoch: number,
		runtime: PiSession,
		message: Extract<UiMessage, { type: "prompt/send" }>,
		error: unknown,
	) {
		if (submission.cancelled || submission.ended || this.epoch !== epoch) {
			runtime.clearQueue();
		}
		if (this.epoch === epoch) {
			this.emit({
				type: "request/failed",
				requestId: message.requestId,
				error:
					error instanceof Error
						? error.message
						: "Piへの追加指示に失敗しました。",
			});
		}
	}

	/** SDK の `prompt` が終了するまで `running` を維持し、ツール間の `turn_end` では完了しない。 */
	private finish(
		submission: Submission,
		error?: string,
		aborted = false,
	): void {
		const cancelled = submission.cancelled || aborted;
		if (this.runtime) {
			setPiSessionRunning(this.runtime.sessionId, false);
		}
		this.submission = undefined;
		this.runtime?.clearQueue();
		submission.abort.abort();
		// SDK 内部でモデルが変わっていても、旧プロバイダーの利用枠を再公開しない。
		this.cancelQuota();
		this.patch({
			run: finishedRunStatus(cancelled, error),
			error: this.finishedError(cancelled, error),
			tools: this.finishedTools(cancelled, error),
			messages: this.state.messages.map((message) => ({
				...message,
				streaming: false,
			})),
			...this.runtime?.account?.snapshot(),
			usage: this.contextUsage(),
		});
		this.refreshQuota();
	}

	/** ユーザーの停止とは別に起きた保存失敗を隠さない。 */
	private finishedError(cancelled: boolean, error: string | undefined) {
		return (
			this.runtime?.history?.outputs?.error ??
			(cancelled ? null : (error ?? null))
		);
	}

	/** 保存が完了した本文だけを永続ファイルの参照へ切り替える。 */
	private finishedTools(cancelled: boolean, error: string | undefined) {
		const tools = finishPiTools(this.state, cancelled, error);
		return (
			this.runtime?.history?.outputs?.project(tools, this.state.runId) ??
			tools
		);
	}

	/** 実行前なら `preflight` で遮断し、実行中なら SDK の `abort` へ渡す。 */
	protected cancel(): void {
		const submission = this.submission;
		const runtime = this.runtime;
		if (!submission && runtime) {
			this.track(runtime.abort());
			return;
		}
		if (!submission || !runtime || submission.cancelled) {
			return;
		}
		submission.cancelled = true;
		runtime.clearQueue();
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
		if (this.runtime) {
			setPiSessionRunning(this.runtime.sessionId, false);
		}
		if (this.submission) {
			this.runtime?.clearQueue();
			this.submission.cancelled = true;
			this.submission.abort.abort();
			this.submission.unsubscribe();
			this.submission = undefined;
		}
	}

	/** 現在の送信が受理された場合だけ下書きを解放する。 */
	private createPromptStarter(
		runtime: PiSession,
		current: () => boolean,
		submission: Submission,
		message: Extract<UiMessage, { type: "prompt/send" }>,
	) {
		return (text: string) =>
			runtime.prompt(text, {
				expandPromptTemplates: false,
				preflightResult: (disposition) => {
					if (!current() || submission.cancelled) {
						throw new Error("送信を停止しました。");
					}
					// 拡張が処理した入力も下書きを解放するが、通常の会話本文には追加しない。
					switch (disposition) {
						case "started":
						case "queued":
							this.appendUserMessage(message);
							break;
						case "handled":
							break;
					}
					submission.accepted = true;
					this.emit({
						type: "prompt/accepted",
						requestId: message.requestId,
						mode: disposition === "queued" ? "steer" : "start",
					});
				},
			});
	}

	/** 現在の送信だけへ SDK のイベントと利用量を反映する。 */
	private createRunEventListener(
		current: () => boolean,
		mapper: PiEventMapper,
	): Parameters<PiSession["subscribe"]>[0] {
		return (event) => {
			if (!current()) {
				return;
			}
			const patch = mapper.apply(event, this.state);
			if (patch) {
				this.patch(patch);
			}
			// `message_end` の通知時点では SDK の履歴保存が終わっていない。
			if (event.type === "turn_end" || event.type === "compaction_end") {
				this.patch({ usage: this.contextUsage() });
			}
		};
	}

	/** 保存済みの表示順を維持して子エージェントを追加する。 */
	private createAgentTimelineEntry(): (
		agent: ChatState["agents"][number],
	) => ChatState["agents"][number] {
		return (agent) => ({
			...agent,
			order:
				this.state.agents.find(
					(item) => item.threadId === agent.threadId,
				)?.order ?? nextTimelineOrder(this.state),
		});
	}

	/** 追加指示を待ってから送信を完了し、購読を必ず回収する。 */
	private trackSubmission(
		input: Promise<void>,
		submission: Submission,
		mapper: PiEventMapper,
		current: () => boolean,
		message: Extract<UiMessage, { type: "prompt/send" }>,
	) {
		const operation = input
			.then(
				async () => {
					submission.ended = true;
					if (submission.steering) {
						await submission.steering;
					}
					if (current()) {
						this.finish(submission, mapper.error, mapper.aborted);
					}
				},
				async (error: unknown) => {
					submission.ended = true;
					if (submission.steering) {
						await submission.steering;
					}
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
}

/** 停止を優先して送信処理の最終状態を確定する。 */
function finishedRunStatus(
	cancelled: boolean,
	error: string | undefined,
): "cancelled" | "failed" | "completed" {
	if (cancelled) {
		return "cancelled";
	}
	if (error) {
		return "failed";
	}
	return "completed";
}
