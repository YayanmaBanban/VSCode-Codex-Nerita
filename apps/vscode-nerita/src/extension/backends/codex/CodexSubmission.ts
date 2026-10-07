// 追加指示の待機・送信を管理し、受付が確定するまで二重送信を防ぐ。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { ChatState } from "@nerita/shared/chatState";

import type { ChangeScope } from "@nerita/shared/changeReferences";
import type { CodeReference } from "@nerita/shared/codeReferences";
import { type Attachment } from "@nerita/shared/composer";
import type { ComposerReference } from "@nerita/shared/composerReferences";
import { mcpSummaryText } from "@nerita/shared/mcp";
import type { SessionContextReference } from "@nerita/shared/sessionReferences";
import { randomUUID } from "node:crypto";
import { readCodeReferenceContext } from "../../session/codeReferenceContext";
import { buildSessionReferenceContext } from "../../session/SessionReferenceContext";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { type ActiveTurn } from "./ActiveTurn";
import { type UserInput } from "./codex-app-server/v2/UserInput";
import type { CodexOptions } from "./CodexOptions";
import { type AdditionalContext } from "./context/additionalContext";
import { changeContext } from "./context/changeContext";
import { generateCodexHandoff } from "./context/handoffGeneration";
import { readSessionContext } from "./context/sessionContext";
import { skillInput } from "./context/skillInput";
import { listMcpServers } from "./mcpStatus";
import { type CodexConnection, type CodexFactory } from "./runtime/connection";

/** 開始状態と取消しを参照し、ターン自体の生成・更新は実行管理へ委ねる。 */
type SubmissionTurn = Readonly<
	Pick<ActiveTurn, "threadId" | "turnId" | "started" | "abort">
>;

/** 会話状態とターンの管理はコントローラーへ委ね、準備後のターン開始と添付の読み取りに使う操作を受け取る。 */
type SubmissionSession = {
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	epoch: () => number;
	busy: () => boolean;
	/** 追加指示の前後で同じターンを照合するため、元の参照を返す。 */
	active: () => SubmissionTurn | undefined;
	patch: (change: Partial<ChatState>) => void;
	prompt: (
		text: string,
		context: AdditionalContext | undefined,
		references: ComposerReference[],
	) => Promise<void>;
	prepareAttachments: (files: Attachment[]) => Promise<UserInput[]>;
};

/** 古い準備の後片付けが、新しい送信の待機や取消しを解除しないよう操作を識別する。 */
type SubmissionOperation = {
	epoch: number;
	sessionId: string;
	abort: AbortController;
};

/** 最新のターン状態に応じて通常送信とフォローアップを選ぶ。 */
export class CodexSubmission {
	private operation: SubmissionOperation | undefined;
	constructor(
		private readonly session: SubmissionSession,
		private readonly options: CodexOptions,
		private readonly factory: CodexFactory,
	) {}

	/** 接続・会話を切り替えた後の古い準備で、新しい操作を待たせない。 */
	get pending(): boolean {
		return this.operation !== undefined && this.current(this.operation);
	}
	/** 同じ操作・接続・会話の準備結果だけを反映する。 */
	private current(operation: SubmissionOperation): boolean {
		return (
			this.operation === operation &&
			operation.epoch === this.session.epoch() &&
			operation.sessionId === this.session.snapshot().sessionId
		);
	}
	/** 同時送信を拒否し、旧接続に残った準備は取り消してから操作を確保する。 */
	private begin(sessionId: string): SubmissionOperation {
		if (this.pending) {
			throw new Error("Submission pending");
		}
		this.operation?.abort.abort();
		const operation = {
			epoch: this.session.epoch(),
			sessionId,
			abort: new AbortController(),
		};
		this.operation = operation;
		return operation;
	}
	/** 終了した操作自身だけが待機状態を解除する。 */
	private finish(operation: SubmissionOperation): void {
		if (this.operation === operation) {
			this.operation = undefined;
		}
	}

	/** 送信準備の取り消しだけを行い、開始済みターンの停止はコントローラーへ委ねる。 */
	cancel(): void {
		this.operation?.abort.abort();
	}

	/** 参照のない通常送信で、実行 ID 確保前に非同期待機を追加しない。 */
	private needsSubmissionContext(
		sessions: SessionContextReference[],
		changes: ChangeScope[],
		code: CodeReference[],
	): boolean {
		return (
			sessions.length > 0 ||
			changes.length > 0 ||
			code.length > 0 ||
			this.session.snapshot().run === "running"
		);
	}

	/** 読み込み後も同じ実行へ追加入力できることを確認する。 */
	private checkSteerTurn(run: SubmissionTurn): void {
		if (this.session.active() !== run || run.abort.signal.aborted) {
			throw new Error("Turn changed");
		}
	}

	/** モデルのターンを開始せず、現在の会話へ MCP 一覧を追記する。 */
	async showMcpStatus(sessionId: string): Promise<void> {
		const operation = this.begin(sessionId);
		const id = randomUUID();
		try {
			const check = () => this.checkSubmission(operation);
			check();
			const order = nextTimelineOrder(this.session.snapshot());
			this.session.patch({
				messages: [
					...this.session.snapshot().messages,
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
				this.session.connection()!,
				sessionId,
				check,
			);
			check();
			this.session.patch({
				messages: this.session.snapshot().messages.map((message) =>
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
			if (
				this.session
					.snapshot()
					.messages.some((message) => message.id === id)
			) {
				this.session.patch({
					messages: this.session.snapshot().messages.map((message) =>
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
			this.finish(operation);
		}
	}

	/** 待機中の完了を反映し、接続や会話が変わった要求は送らない。 */
	async submitPrompt(
		text: string,
		sessionId: string,
		sessionReferences: SessionContextReference[] = [],
		changeScopes: ChangeScope[] = [],
		codeReferences: CodeReference[] = [],
		references: ComposerReference[] = [],
	): Promise<"start" | "steer"> {
		const operation = this.begin(sessionId);
		const waitingRun = this.session.active();
		const preparation = this.beginContextPreparation(
			sessionReferences,
			operation,
		);
		/** 明示的な停止や失敗の後に、待機中の指示で実行を再開しない。 */
		const checkWaitingRun = this.createWaitingRunCheck(waitingRun);
		try {
			this.checkSubmission(operation);
			// `Goal` は API のモードではなく、送信する指示の接頭辞として扱う。
			text = this.submissionText(text);
			const context = this.needsSubmissionContext(
				sessionReferences,
				changeScopes,
				codeReferences,
			)
				? await this.prepareSubmissionContext(
						sessionReferences,
						operation,
						waitingRun,
						changeScopes,
						codeReferences,
						checkWaitingRun,
						text,
					)
				: undefined;
			this.checkSubmission(operation);
			checkWaitingRun();
			preparation.ready();
			if (!this.session.busy()) {
				await this.session.prompt(text, context, references);
				this.checkSubmission(operation);
				return "start";
			}
			const { run, client } = this.requireSteerTurn();
			const files = [...this.session.snapshot().attachments];
			const attachments =
				files.length > 0
					? await this.session.prepareAttachments(files)
					: [];
			this.checkSubmission(operation);
			checkWaitingRun();
			// 添付の読み込み中に完了した場合も通常送信へ切り替える。
			if (!this.session.busy()) {
				await this.session.prompt(text, context, references);
				this.checkSubmission(operation);
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
				operation,
				references,
				files,
			);
			return "steer";
		} finally {
			preparation.finish();
			this.finish(operation);
		}
	}

	/** 停止や失敗の後に待機中の指示で実行を再開しない。 */
	private createWaitingRunCheck(waitingRun: SubmissionTurn | undefined) {
		return () => {
			if (
				waitingRun?.abort.signal.aborted === true &&
				this.session.snapshot().run !== "completed"
			) {
				throw new Error("Pending submission cancelled");
			}
		};
	}

	/** 生成待ちの停止ボタンと取消を、通常ターンから分離する。 */
	private beginContextPreparation(
		refs: SessionContextReference[],
		operation: SubmissionOperation,
	) {
		let preparing =
			!this.session.busy() && refs.some((ref) => ref.mode === "handoff");
		const previousRun = {
			run: this.session.snapshot().run,
			runId: this.session.snapshot().runId,
		};
		const abort = operation.abort;
		if (preparing) {
			this.session.patch({ run: "running", runId: randomUUID() });
		}
		const restore = () => {
			if (
				preparing &&
				this.current(operation) &&
				!this.session.active()
			) {
				this.session.patch(previousRun);
				preparing = false;
			}
		};
		return {
			ready: () => {
				abort.signal.throwIfAborted();
				restore();
			},
			finish: restore,
		};
	}

	/** `Goal` モードの入力に必要な接頭辞だけを補う。 */
	private submissionText(text: string) {
		if (this.options.mode === "goal" && !/^\s*\/goal(?:\s|$)/u.test(text)) {
			text = `/goal ${text}`;
		}
		return text;
	}

	/** 追加入力を受け取れる開始済みターンを確認する。 */
	private requireSteerTurn() {
		const run = this.session.active();
		const client = this.session.connection()!;
		if (
			this.session.snapshot().run !== "running" ||
			!isNonEmptyString(run?.turnId) ||
			!run.started
		) {
			throw new Error("Turn not ready");
		}
		return { run, client };
	}

	/** 追加指示の受付を確認して表示と添付を更新する。 */
	private async acceptSteeredPrompt(
		client: CodexConnection,
		context: AdditionalContext | undefined,
		sessionId: string,
		run: SubmissionTurn,
		text: string,
		attachments: UserInput[],
		operation: SubmissionOperation,
		references: ComposerReference[],
		files: Attachment[],
	) {
		const id = randomUUID();
		const order = nextTimelineOrder(this.session.snapshot());
		// 受付不明のエラーでは自動再送しない。重複した指示の実行を避ける。
		const result = await client.steerTurn({
			...(context ? { additionalContext: context } : {}),
			threadId: sessionId,
			expectedTurnId: run.turnId!,
			clientUserMessageId: id,
			input: [
				{ type: "text", text, text_elements: [] },
				...attachments,
				...skillInput(text, this.session.snapshot().skills),
			],
		});
		this.checkSubmission(operation);
		if (result.turnId !== run.turnId) {
			throw new Error("Unexpected turn");
		}
		this.session.patch({
			messages: [
				...this.session.snapshot().messages,
				{
					id,
					role: "user",
					text,
					order,
					references,
					attachments: files,
				},
			],
			attachments: this.session
				.snapshot()
				.attachments.filter(
					(item) => !files.some((file) => file.id === item.id),
				),
		});
	}

	/** 会話・変更・コード参照を送信直前の状態で読み込む。 */
	private async prepareSubmissionContext(
		sessionReferences: SessionContextReference[],
		operation: SubmissionOperation,
		waitingRun: SubmissionTurn | undefined,
		changeScopes: ChangeScope[],
		codeReferences: CodeReference[],
		checkWaitingRun: () => void,
		goal: string,
	) {
		const current = () =>
			this.current(operation) &&
			!(
				waitingRun?.abort.signal.aborted === true &&
				this.session.snapshot().run !== "completed"
			);
		const abort = new AbortController();
		const monitor = setInterval(() => {
			if (!current()) {
				abort.abort();
			}
		}, 50);
		let context: AdditionalContext | undefined;
		try {
			context =
				sessionReferences.length > 0
					? await this.buildSubmissionReferences(
							sessionReferences,
							operation,
							goal,
							abort,
							checkWaitingRun,
							current,
						)
					: undefined;
		} finally {
			clearInterval(monitor);
		}

		if (changeScopes.length > 0) {
			context = {
				...context,
				...(await changeContext(
					this.session.snapshot().cwd!,
					changeScopes,
				)),
			};
		}
		if (this.session.snapshot().run === "running") {
			await new Promise<void>((resolve) => setTimeout(resolve, 500));
		}
		if (codeReferences.length > 0) {
			const value = await readCodeReferenceContext(codeReferences, () => {
				this.checkSubmission(operation);
				checkWaitingRun();
			});
			context = {
				...context,
				code_references: { value, kind: "untrusted" },
			};
		}
		return context;
	}

	/** 送信する会話参照を同じ接続世代と停止条件で準備する。 */
	private buildSubmissionReferences(
		sessionReferences: SessionContextReference[],
		operation: SubmissionOperation,
		goal: string,
		abort: AbortController,
		checkWaitingRun: () => void,
		current: () => boolean,
	):
		| AdditionalContext
		| PromiseLike<AdditionalContext | undefined>
		| undefined {
		return buildSessionReferenceContext({
			references: sessionReferences,
			currentId: operation.sessionId,
			cwd: this.session.snapshot().cwd!,
			backend: "codex",
			model: this.options.model,
			goal,
			signal: AbortSignal.any([abort.signal, operation.abort.signal]),
			check: () => {
				this.checkSubmission(operation);
				checkWaitingRun();
			},
			read: (ref) =>
				readSessionContext(
					this.session.connection()!,
					ref.sessionId,
					this.session.snapshot().cwd!,
					current,
					ref.mode,
				),
			generate: (request) =>
				generateCodexHandoff(
					this.factory,
					this.session.snapshot().cwd!,
					request,
				),
		});
	}

	/** 待機や読み込みをまたいでも送信先と接続世代を固定する。 */
	private checkSubmission(operation: SubmissionOperation): void {
		if (
			!this.current(operation) ||
			!this.session.connection() ||
			this.session.snapshot().connection !== "ready" ||
			this.session.snapshot().sessionPending ||
			this.session.snapshot().configPending ||
			this.session.snapshot().attachmentPending
		) {
			throw new Error("Submission unavailable");
		}
	}
}
