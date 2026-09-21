// 追加指示の待機・送信を管理し、受付が確定するまで二重送信を防ぐ。
import { randomUUID } from "node:crypto";
import { CodexHistory } from "./CodexHistory";
import { attachmentInput } from "./context/attachmentInput";
import { skillInput } from "./context/skillInput";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { sessionContext } from "./context/sessionContext";
import { changeContext } from "./context/changeContext";
import type { ChangeScope } from "../../../shared/changeReferences";
import { listMcpServers } from "./mcpStatus";
import { mcpSummaryText } from "../../../shared/mcp";

/** 最新のターン状態に応じて通常送信とフォローアップを選ぶ。 */
export abstract class CodexSubmission extends CodexHistory {
	protected submissionPending = false;

	/** モデルのターンを開始せず、現在の会話へMCP一覧を追記する。 */
	protected async showMcpStatus(sessionId: string): Promise<void> {
		if (this.submissionPending) {
			throw new Error("Submission pending");
		}
		const epoch = this.epoch;
		const id = randomUUID();
		this.submissionPending = true;
		try {
			const check = () => this.checkSubmission(epoch, sessionId);
			check();
			const order = nextTimelineOrder(this.state);
			this.patch({
				messages: [
					...this.state.messages,
					{ id: randomUUID(), role: "user", text: "/mcp", order },
					{
						id,
						role: "assistant",
						text: "取得中…",
						streaming: false,
						mcp: { status: "loading" },
						order: order + 1,
					},
				],
			});
			const servers = await listMcpServers(
				this.client!,
				sessionId,
				check,
			);
			check();
			this.patch({
				messages: this.state.messages.map((message) =>
					message.id === id
						? {
								...message,
								text: mcpSummaryText(servers),
								mcp: { status: "ready", servers },
							}
						: message,
				),
			});
		} catch (error) {
			// 接続変更後も同じ待機メッセージが残る場合だけ、取得中表示を終了する。
			if (this.state.messages.some((message) => message.id === id)) {
				this.patch({
					messages: this.state.messages.map((message) =>
						message.id === id
							? {
									...message,
									text: "MCPサーバーの状態を取得できませんでした。再試行してください。",
									mcp: { status: "error" },
								}
							: message,
					),
				});
			}
			throw error;
		} finally {
			this.submissionPending = false;
		}
	}

	/** 待機中の完了を反映し、接続や会話が変わった要求は送らない。 */
	protected async submitPrompt(
		text: string,
		sessionId: string,
		referencedSessionIds: string[] = [],
		changeScopes: ChangeScope[] = [],
	): Promise<"start" | "steer"> {
		if (this.submissionPending) {
			throw new Error("Submission pending");
		}
		this.submissionPending = true;
		const epoch = this.epoch;
		const waitingRun = this.active;
		/** 明示的な停止や失敗の後に、待機中の指示で実行を再開しない。 */
		const checkWaitingRun = () => {
			if (
				waitingRun?.abort.signal.aborted &&
				this.state.run !== "completed"
			) {
				throw new Error("Pending submission cancelled");
			}
		};
		try {
			this.checkSubmission(epoch, sessionId);
			let context = referencedSessionIds.length
				? await sessionContext(
						this.client!,
						referencedSessionIds,
						sessionId,
						this.state.cwd!,
						() =>
							epoch === this.epoch &&
							sessionId === this.state.sessionId &&
							!(
								waitingRun?.abort.signal.aborted &&
								this.state.run !== "completed"
							),
					)
				: undefined;
			if (changeScopes.length) {
				context = {
					...context,
					...(await changeContext(this.state.cwd!, changeScopes)),
				};
			}
			if (this.state.run === "running") {
				await new Promise<void>((resolve) => setTimeout(resolve, 500));
			}
			this.checkSubmission(epoch, sessionId);
			checkWaitingRun();
			if (!this.busy()) {
				await this.prompt(text, context);
				this.checkSubmission(epoch, sessionId);
				return "start";
			}
			const run = this.active;
			const client = this.client!;
			if (this.state.run !== "running" || !run?.turnId || !run.started) {
				throw new Error("Turn not ready");
			}
			const files = [...this.state.attachments];
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
			this.checkSubmission(epoch, sessionId);
			checkWaitingRun();
			// 添付の読み込み中に完了した場合も通常送信へ切り替える。
			if (!this.busy()) {
				await this.prompt(text, context);
				this.checkSubmission(epoch, sessionId);
				return "start";
			}
			if (this.active !== run || run.abort.signal.aborted) {
				throw new Error("Turn changed");
			}
			const id = randomUUID();
			const order = nextTimelineOrder(this.state);
			// 受付不明のエラーでは自動再送しない。重複した指示の実行を避ける。
			const result = await client.steerTurn({
				...(context ? { additionalContext: context } : {}),
				threadId: sessionId,
				expectedTurnId: run.turnId,
				clientUserMessageId: id,
				input: [
					{ type: "text", text, text_elements: [] },
					...attachments,
					...skillInput(text, this.state.skills),
				],
			});
			this.checkSubmission(epoch, sessionId);
			if (result.turnId !== run.turnId) {
				throw new Error("Unexpected turn");
			}
			this.patch({
				messages: [
					...this.state.messages,
					{ id, role: "user", text, order },
				],
				attachments: this.state.attachments.filter(
					(item) => !files.some((file) => file.id === item.id),
				),
			});
			return "steer";
		} finally {
			this.submissionPending = false;
		}
	}

	/** 待機や読み込みをまたいでも送信先と接続世代を固定する。 */
	private checkSubmission(epoch: number, sessionId: string): void {
		if (
			this.epoch !== epoch ||
			this.state.sessionId !== sessionId ||
			!this.client ||
			this.state.connection !== "ready" ||
			this.state.sessionPending ||
			this.state.configPending ||
			this.state.attachmentPending
		) {
			throw new Error("Submission unavailable");
		}
	}
}
