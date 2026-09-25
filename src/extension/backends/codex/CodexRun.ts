// 開始受付とターン完了を分け、早い停止・遅い通知・承認を1つの実行に限定する。
import { randomUUID } from "node:crypto";
import type { ComposerReference } from "../../../shared/composerReferences";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { CodexAgents } from "./CodexAgents";
import { attachmentInput } from "./context/attachmentInput";
import { skillInput } from "./context/skillInput";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { parseTurnEvent, type TurnEvent } from "./items/turnEvents";
import { applyTurnEvent } from "./items/applyTurnEvent";
import { ActiveTurn } from "./ActiveTurn";
import type { AdditionalContext } from "./context/additionalContext";
import { type Attachment } from "@/shared/composer";
import { type TurnInfo } from "./protocol/turn";
import { isRecord } from "../../../shared/validation";

/** 同じ thread で停止後も会話を続けられる実行管理。 */
export abstract class CodexRun extends CodexAgents {
	private cancelTimer: NodeJS.Timeout | undefined;
	private planText: string | null = null;

	/** 会話と添付の準備中は実行を開始しない。 */
	private promptPending(): boolean {
		return this.state.sessionPending || this.state.attachmentPending;
	}

	/** 表示用の実行 ID を先に確保し、完了は通知だけで確定する。 */
	protected async prompt(
		text: string,
		context?: AdditionalContext,
		references: ComposerReference[] = [],
	): Promise<void> {
		if (
			this.busy() ||
			!this.client ||
			!this.state.sessionId ||
			this.promptPending()
		) {
			throw new Error("Busy");
		}

		const run = new ActiveTurn(this.state.sessionId);
		this.planText = null;
		this.active = run;
		const userId = randomUUID();
		this.patch({
			run: "running",
			planDecision: null,
			runId: randomUUID(),
			error: null,
			messages: [
				...this.state.messages,
				{
					id: userId,
					references,
					role: "user",
					text,
					order: nextTimelineOrder(this.state),
				},
			],
		});

		let prepared = false;
		try {
			const files = [...this.state.attachments];
			const attachments = files.length
				? await this.prepareAttachments(files)
				: [];

			this.checkPreparedTurn(run);

			prepared = true;
			const result = await this.client.startTurn({
				...(context ? { additionalContext: context } : {}),
				...this.turnOptions,
				collaborationMode: this.collaborationSettings(),
				threadId: run.threadId,
				clientUserMessageId: userId,
				input: [
					{ type: "text", text, text_elements: [] },
					...attachments,
					...skillInput(text, this.state.skills),
				],
			});
			if (this.active !== run) {
				return;
			}

			this.acceptStartedTurn(run, result, files);
		} catch (error) {
			this.rejectSubmission(run, prepared, userId);
			throw error;
		}
	}
	/** 添付の読み取り中に停止または会話変更がなかったか確認する。 */
	private checkPreparedTurn(run: ActiveTurn) {
		if (this.active !== run) {
			throw new Error("Run changed before submission");
		}
		if (run.abort.signal.aborted) {
			this.finish("cancelled");
			throw new Error("Submission cancelled");
		}
	}

	/** 開始失敗時の表示と送信メッセージを取り消す。 */
	private rejectSubmission(
		run: ActiveTurn,
		prepared: boolean,
		userId: string,
	) {
		if (this.active === run) {
			this.finish("failed");
			if (!prepared) {
				this.patch({
					error: "添付を読み込めませんでした。UTF-8テキスト（合計2MBまで）または画像対応モデルの画像を選択してください。",
				});
			}
		}
		this.patch({
			messages: this.state.messages.filter((item) => item.id !== userId),
		});
	}

	/** 開始済みターンへ先行通知と停止要求を反映する。 */
	private acceptStartedTurn(
		run: ActiveTurn,
		result: { turn: TurnInfo },
		files: Attachment[],
	) {
		run.turnId = result.turn.id;
		this.patch({
			attachments: this.state.attachments.filter(
				(item) => !files.some((file) => file.id === item.id),
			),
		});
		run.release();
		for (const event of run.events.splice(0)) {
			this.applyEvent(event);
		}
		if (this.active === run && this.state.run === "cancelling") {
			this.interrupt();
		}
	}

	/** モデルの画像対応を確認して添付を読み込む。 */
	private async prepareAttachments(files: Attachment[]) {
		const model =
			this.turnOptions.model ??
			this.state.configOptions.find((item) => item.id === "model")
				?.currentValue;
		const attachments = files.length
			? await attachmentInput(
					files,
					this.models
						.find((item) => item.model === model)
						?.inputModalities.includes("image") ?? false,
				)
			: [];
		return attachments;
	}

	/** 開始応答前の Stop も保持し、ターン ID が判明したら一度だけ送信する。 */
	protected cancel(): void {
		if (this.state.run !== "running" || !this.active) {
			return;
		}
		const run = this.active;
		this.patch({ run: "cancelling" });
		run.abort.abort();
		this.cancelTimer = setTimeout(() => {
			if (this.active === run) {
				this.failConnection(
					"停止を確認できなかったため接続を終了しました。再接続してください。",
				);
			}
		}, 10_000);
		this.interrupt();
	}
	/** interrupt の応答後も turn/completed まで停止待ちを維持する。 */
	private interrupt(): void {
		const run = this.active;
		if (!run?.turnId || !run.started || run.interruptSent || !this.client) {
			return;
		}
		run.interruptSent = true;
		void this.client.interruptTurn(run.threadId, run.turnId).catch(() => {
			if (this.active === run) {
				this.failConnection(
					"ターンを停止できませんでした。再接続してください。",
				);
			}
		});
	}
	/** 開始応答より先の通知を保存し、前のターンの遅い通知は適用しない。 */
	protected override notification(message: AppServerNotification): void {
		super.notification(message);
		const event = parseTurnEvent(message);
		if (!event || !this.active || event.threadId !== this.active.threadId) {
			return;
		}
		if (!this.active.turnId) {
			if (this.active.events.length >= 10_000) {
				throw new Error("Too many early events");
			}
			this.active.events.push(event);
		} else {
			this.applyEvent(event);
		}
	}
	/** 完了項目・完了ターンの後に届いた delta で確定本文を壊さない。 */
	private applyEvent(event: TurnEvent): void {
		const run = this.active;
		if (
			!run ||
			event.threadId !== run.threadId ||
			event.turnId !== run.turnId
		) {
			return;
		}
		this.capturePlan(event);

		applyTurnEvent(run, event, {
			snapshot: () => this.state,
			patch: (change) => this.patch(change),
			agentNotification: (message) => this.agentNotification(message),
			interrupt: () => this.interrupt(),
			finish: (status) => {
				const planText = this.planText?.trim();
				this.finish(status);
				if (
					status === "completed" &&
					this.collaborationMode === "plan" &&
					planText
				) {
					this.patch({
						planDecision: {
							runId: this.state.runId!,
							text: planText,
						},
					});
				}
			},
		});
	}
	/** 完了通知に Plan 本文がない場合も項目通知から保持する。 */
	private capturePlan(event: TurnEvent) {
		if (
			event.kind === "item" &&
			event.item.type === "plan" &&
			typeof event.item.text === "string"
		) {
			this.planText = event.item.text;
		}
		if (event.kind === "turn" && event.completed) {
			for (let index = event.items.length - 1; index >= 0; index--) {
				const item: unknown = event.items[index];
				if (
					isRecord(item) &&
					item.type === "plan" &&
					typeof item.text === "string"
				) {
					this.planText = item.text;
					break;
				}
			}
		}
	}
	/** 終了時に未完了カードと承認を解消し、会話は保持する。 */
	private finish(status: "completed" | "cancelled" | "failed"): void {
		this.patch({
			tools: this.state.tools.map((tool) =>
				tool.runId === this.state.runId && tool.id.startsWith("turn:")
					? {
							...tool,
							status:
								status === "completed" ? "completed" : "failed",
						}
					: tool,
			),
		});
		this.resetRun();
		this.patch({
			run: status,
			permissions: [],
			error:
				status === "failed"
					? "実行に失敗しました。入力内容とCodexの認証・設定を確認して再送してください。"
					: null,
		});
	}
	/** 待機中の開始応答・承認・停止期限を解放する。 */
	protected override resetRun(): void {
		clearTimeout(this.cancelTimer);
		const run = this.active;
		this.active = undefined;
		run?.release();
		run?.abort.abort();
		if (run) {
			this.patch({
				tools: this.state.tools.map((tool) =>
					tool.runId === this.state.runId &&
					["pending", "in_progress"].includes(tool.status)
						? { ...tool, status: "failed" }
						: tool,
				),
			});
		}
	}
}
