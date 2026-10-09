// 開始受付とターン完了を区別し、通知・停止・承認を対象の実行に対応付ける。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { randomUUID } from "node:crypto";
import type { ComposerReference } from "@nerita/shared/composerReferences";
import { nextTimelineOrder } from "../../session/timelineOrder";
import type { CodexAgents } from "./CodexAgents";
import type { CodexOptions } from "./CodexOptions";
import type { ChatState } from "@nerita/shared/chatState";
import type { CodexConnection } from "./runtime/connection";
import { attachmentInput } from "./context/attachmentInput";
import { skillInput } from "./context/skillInput";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { parseTurnEvent, type TurnEvent } from "./items/turnEvents";
import { applyTurnEvent } from "./items/applyTurnEvent";
import { ActiveTurn } from "./ActiveTurn";
import type { AdditionalContext } from "./context/additionalContext";
import { type Attachment } from "@nerita/shared/composer";
import { type TurnInfo } from "./protocol/turn";
import { isRecord } from "@nerita/shared/validation";

/** 状態と接続はコントローラーから取得し、ターン処理で複製して保持しない。 */
type RunSession = {
	finished?: (status: "completed" | "cancelled" | "failed") => void;
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	busy: () => boolean;
	patch: (change: Partial<ChatState>) => void;
	failConnection: (message: string) => void;
};

/** 同じ `thread` で停止後も会話を続けられる実行管理。 */
export class CodexRun {
	/** ターン処理だけが生成・更新・解除し、承認側には現在の参照を渡す。 */
	private active: ActiveTurn | undefined;
	private cancelTimer: NodeJS.Timeout | undefined;
	private planText: string | null = null;

	constructor(
		private readonly session: RunSession,
		private readonly options: CodexOptions,
		private readonly agents: CodexAgents,
	) {}

	/** 開始待ちや取消しの照合に必要な情報を、元のターン参照で公開する。 */
	get current():
		| Readonly<
				Pick<
					ActiveTurn,
					"threadId" | "turnId" | "started" | "ready" | "abort"
				>
		  >
		| undefined {
		return this.active;
	}

	/** 会話と添付の準備中は実行を開始しない。 */
	private promptPending(): boolean {
		return (
			this.session.snapshot().sessionPending ||
			this.session.snapshot().attachmentPending
		);
	}

	/** 表示用の実行 ID を先に確保し、完了は通知だけで確定する。 */
	async prompt(
		text: string,
		context?: AdditionalContext,
		references: ComposerReference[] = [],
	): Promise<void> {
		const state = this.session.snapshot();
		const client = this.session.connection();
		if (
			this.session.busy() ||
			!client ||
			!isNonEmptyString(state.sessionId) ||
			this.promptPending()
		) {
			throw new Error("Busy");
		}

		const run = new ActiveTurn(state.sessionId);
		this.planText = null;
		this.active = run;
		const userId = randomUUID();
		const files = [...state.attachments];
		this.session.patch({
			run: "running",
			planDecision: null,
			runId: randomUUID(),
			error: null,
			messages: [
				...state.messages,
				{
					id: userId,
					references,
					attachments: files,
					role: "user",
					text,
					order: nextTimelineOrder(state),
				},
			],
		});

		let prepared = false;
		try {
			const attachments =
				files.length > 0 ? await this.prepareAttachments(files) : [];

			this.checkPreparedTurn(run);

			prepared = true;
			const result = await client.startTurn({
				...(context ? { additionalContext: context } : {}),
				...this.options.turnSettings(),
				threadId: run.threadId,
				clientUserMessageId: userId,
				input: [
					{ type: "text", text, text_elements: [] },
					...attachments,
					...skillInput(text, this.session.snapshot().skills),
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
				this.session.patch({
					error: "添付を読み込めませんでした。UTF-8テキスト（合計2MBまで）または画像対応モデルの画像を選択してください。",
				});
			}
		}
		this.session.patch({
			messages: this.session
				.snapshot()
				.messages.filter((item) => item.id !== userId),
		});
	}

	/** 開始済みターンへ先行通知と停止要求を反映する。 */
	private acceptStartedTurn(
		run: ActiveTurn,
		result: { turn: TurnInfo },
		files: Attachment[],
	) {
		run.turnId = result.turn.id;
		this.session.patch({
			attachments: this.session
				.snapshot()
				.attachments.filter(
					(item) => !files.some((file) => file.id === item.id),
				),
		});
		run.release();
		for (const event of run.events.splice(0)) {
			this.applyEvent(event);
		}
		if (
			this.active === run &&
			this.session.snapshot().run === "cancelling"
		) {
			this.interrupt();
		}
	}

	/** モデルの画像対応を確認して添付を読み込む。 */
	async prepareAttachments(files: Attachment[]) {
		const attachments =
			files.length > 0
				? await attachmentInput(files, this.options.supportsImages)
				: [];
		return attachments;
	}

	/** 開始応答前の停止も保持し、応答と開始通知が揃ったら一度だけ送信する。 */
	cancel(): void {
		if (this.session.snapshot().run !== "running" || !this.active) {
			return;
		}
		const run = this.active;
		this.session.patch({ run: "cancelling" });
		run.abort.abort();
		this.cancelTimer = setTimeout(() => {
			if (this.active === run) {
				this.session.failConnection(
					"停止を確認できなかったため接続を終了しました。再接続してください。",
				);
			}
		}, 10_000);
		this.interrupt();
	}
	/** `interrupt` の応答後も `turn/completed` まで停止待ちを維持する。 */
	private interrupt(): void {
		const run = this.active;
		const client = this.session.connection();
		if (
			!isNonEmptyString(run?.turnId) ||
			!run.started ||
			run.interruptSent ||
			!client
		) {
			return;
		}
		run.interruptSent = true;
		void client.interruptTurn(run.threadId, run.turnId).catch(() => {
			if (this.active === run) {
				this.session.failConnection(
					"ターンを停止できませんでした。再接続してください。",
				);
			}
		});
	}
	/** 開始応答より先の通知を保存し、前のターンの遅い通知は適用しない。 */
	notification(message: AppServerNotification): void {
		const event = parseTurnEvent(message);
		if (!event || !this.active || event.threadId !== this.active.threadId) {
			return;
		}
		if (!isNonEmptyString(this.active.turnId)) {
			if (this.active.events.length >= 10_000) {
				throw new Error("Too many early events");
			}
			this.active.events.push(event);
		} else {
			this.applyEvent(event);
		}
	}
	/** 完了項目・完了ターンの後に届いた `delta` で確定本文を壊さない。 */
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
			snapshot: () => this.session.snapshot(),
			patch: (change) => this.session.patch(change),
			agentNotification: (message) => this.agents.notification(message),
			interrupt: () => this.interrupt(),
			finish: (status) => {
				const planText = this.planText?.trim();
				this.finish(status);
				if (
					status === "completed" &&
					this.options.mode === "plan" &&
					isNonEmptyString(planText)
				) {
					this.session.patch({
						planDecision: {
							runId: this.session.snapshot().runId!,
							text: planText,
						},
					});
				}
			},
		});
	}
	/** 完了通知に `Plan` 本文がない場合も項目通知から保持する。 */
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
	/** 終了時に未完了カードの状態を確定し、承認待ちを取り消す。会話は保持する。 */
	private finish(status: "completed" | "cancelled" | "failed"): void {
		this.session.patch({
			tools: this.session.snapshot().tools.map((tool) =>
				tool.runId === this.session.snapshot().runId &&
				tool.id.startsWith("turn:")
					? {
							...tool,
							status:
								status === "completed" ? "completed" : "failed",
						}
					: tool,
			),
		});
		this.reset();
		this.session.patch({
			run: status,
			permissions: [],
			error:
				status === "failed"
					? "実行に失敗しました。入力内容とCodexの認証・設定を確認して再送してください。"
					: null,
		});
		this.session.finished?.(status);
	}
	/** 開始応答の待機を終了し、承認を取り消して停止用タイマーを解除する。 */
	reset(): void {
		clearTimeout(this.cancelTimer);
		const run = this.active;
		this.active = undefined;
		run?.release();
		run?.abort.abort();
		if (run) {
			this.session.patch({
				tools: this.session
					.snapshot()
					.tools.map((tool) =>
						tool.runId === this.session.snapshot().runId &&
						["pending", "in_progress"].includes(tool.status)
							? { ...tool, status: "failed" }
							: tool,
					),
			});
		}
	}
}
