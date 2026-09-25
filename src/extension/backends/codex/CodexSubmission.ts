// 追加指示の待機・送信を管理し、受付が確定するまで二重送信を防ぐ。
import { randomUUID } from "node:crypto";
import type { ComposerReference } from "../../../shared/composerReferences";
import { CodexHistory } from "./CodexHistory";
import { attachmentInput } from "./context/attachmentInput";
import { skillInput } from "./context/skillInput";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { sessionContext } from "./context/sessionContext";
import { changeContext } from "./context/changeContext";
import type { ChangeScope } from "../../../shared/changeReferences";
import { listMcpServers } from "./mcpStatus";
import { mcpSummaryText } from "../../../shared/mcp";
import type { CodeReference } from "../../../shared/codeReferences";
import { readCodeReferenceContext } from "../../session/codeReferenceContext";
import { type Attachment } from "@/shared/composer";
import { type ActiveTurn } from "./ActiveTurn";
import { type UserInput } from "./codex-app-server/v2/UserInput";
import { type AdditionalContext } from "./context/additionalContext";
import { type CodexConnection } from "./runtime/connection";

/** 最新のターン状態に応じて通常送信とフォローアップを選ぶ。 */
export abstract class CodexSubmission extends CodexHistory {
	protected submissionPending = false;

	/** 参照のない通常送信で、実行 ID 確保前に非同期待機を追加しない。 */
	private needsSubmissionContext(
		sessions: string[],
		changes: ChangeScope[],
		code: CodeReference[],
	): boolean {
		return (
			sessions.length > 0 ||
			changes.length > 0 ||
			code.length > 0 ||
			this.state.run === "running"
		);
	}

	/** 読み込み後も同じ実行へ追加入力できることを確認する。 */
	private checkSteerTurn(run: ActiveTurn): void {
		if (this.active !== run || run.abort.signal.aborted) {
			throw new Error("Turn changed");
		}
	}

	/** モデルのターンを開始せず、現在の会話へ MCP 一覧を追記する。 */
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
		codeReferences: CodeReference[] = [],
		references: ComposerReference[] = [],
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
			// Goal は API のモードではなく、送信する指示の接頭辞として扱う。
			text = this.submissionText(text);
			const context = this.needsSubmissionContext(
				referencedSessionIds,
				changeScopes,
				codeReferences,
			)
				? await this.prepareSubmissionContext(
						referencedSessionIds,
						sessionId,
						epoch,
						waitingRun,
						changeScopes,
						codeReferences,
						checkWaitingRun,
					)
				: undefined;
			this.checkSubmission(epoch, sessionId);
			checkWaitingRun();
			if (!this.busy()) {
				await this.prompt(text, context, references);
				this.checkSubmission(epoch, sessionId);
				return "start";
			}
			const { run, client } = this.requireSteerTurn();
			const files = [...this.state.attachments];
			const attachments = files.length
				? await this.prepareSteerAttachments(files)
				: [];
			this.checkSubmission(epoch, sessionId);
			checkWaitingRun();
			// 添付の読み込み中に完了した場合も通常送信へ切り替える。
			if (!this.busy()) {
				await this.prompt(text, context, references);
				this.checkSubmission(epoch, sessionId);
				return "start";
			}
			this.checkSteerTurn(run);
			await this.acceptSteeredPrompt(
				client,
				context,
				sessionId,
				run,
				text,
				attachments,
				epoch,
				references,
				files,
			);
			return "steer";
		} finally {
			this.submissionPending = false;
		}
	}

	/** Goal モードの入力に必要な接頭辞だけを補う。 */
	private submissionText(text: string) {
		if (
			this.collaborationMode === "goal" &&
			!/^\s*\/goal(?:\s|$)/u.test(text)
		) {
			text = `/goal ${text}`;
		}
		return text;
	}

	/** 追加入力を受け取れる開始済みターンを確認する。 */
	private requireSteerTurn() {
		const run = this.active;
		const client = this.client!;
		if (this.state.run !== "running" || !run?.turnId || !run.started) {
			throw new Error("Turn not ready");
		}
		return { run, client };
	}

	/** 追加指示の受付を確認して表示と添付を更新する。 */
	private async acceptSteeredPrompt(
		client: CodexConnection,
		context: AdditionalContext | undefined,
		sessionId: string,
		run: ActiveTurn,
		text: string,
		attachments: UserInput[],
		epoch: number,
		references: ComposerReference[],
		files: Attachment[],
	) {
		const id = randomUUID();
		const order = nextTimelineOrder(this.state);
		// 受付不明のエラーでは自動再送しない。重複した指示の実行を避ける。
		const result = await client.steerTurn({
			...(context ? { additionalContext: context } : {}),
			threadId: sessionId,
			expectedTurnId: run.turnId!,
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
				{ id, role: "user", text, order, references },
			],
			attachments: this.state.attachments.filter(
				(item) => !files.some((file) => file.id === item.id),
			),
		});
	}

	/** 会話・変更・コード参照を送信直前の状態で読み込む。 */
	private async prepareSubmissionContext(
		referencedSessionIds: string[],
		sessionId: string,
		epoch: number,
		waitingRun: ActiveTurn | undefined,
		changeScopes: ChangeScope[],
		codeReferences: CodeReference[],
		checkWaitingRun: () => void,
	) {
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
		if (codeReferences.length) {
			const value = await readCodeReferenceContext(codeReferences, () => {
				this.checkSubmission(epoch, sessionId);
				checkWaitingRun();
			});
			context = {
				...context,
				code_references: { value, kind: "untrusted" },
			};
		}
		return context;
	}

	/** 追加入力に添えるファイルをモデルの対応形式で読み込む。 */
	private async prepareSteerAttachments(files: Attachment[]) {
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
