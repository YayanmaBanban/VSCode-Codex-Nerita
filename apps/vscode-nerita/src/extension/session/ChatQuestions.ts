// 質問の待機を接続・実行の寿命に結び付け、回答本文を会話状態に残さない。
import { randomUUID } from "node:crypto";
import type { ChatState } from "@nerita/shared/chatState";
import {
	questionFieldError,
	questionSpecSchema,
	type QuestionAnswer,
	type QuestionSpec,
	type QuestionRequest,
	type QuestionResponse,
} from "@nerita/shared/questions";

/** 追加の検証は Host 内に閉じ、Webview に実行可能なコードを渡さない。 */
export type QuestionAsk = (
	spec: QuestionSpec,
	signal: AbortSignal,
	validate?: (answers: Record<string, string>) => string | undefined,
) => Promise<QuestionAnswer>;

/** 公開する質問と、Host 内だけで使う回答の返却処理・検証関数を分離する。 */
type PendingQuestion = {
	request: QuestionRequest;
	finish: (answer: QuestionAnswer) => void;
	validate?: (answers: Record<string, string>) => string | undefined;
};

/** ID と表示時の会話・実行を照合し、古いカードの回答を受け付けない。 */
export class ChatQuestions {
	private pending = new Map<string, PendingQuestion>();
	/** 表示時の文脈を取得し、カードだけを会話状態へ公開する。 */
	constructor(
		private readonly context: () => Pick<ChatState, "sessionId" | "runId">,
		private readonly publish: (questions: QuestionRequest[]) => void,
	) {}

	/** 取り消し済みの要求は表示せず、`AbortSignal` の取り消し通知で回答待ちを終了する。 */
	ask: QuestionAsk = (spec, signal, validate) => {
		if (signal.aborted) {
			return Promise.resolve({ action: "cancel", answers: {} });
		}
		const parsed = questionSpecSchema.parse(spec);
		const id = randomUUID();
		const context = this.context();
		const request = {
			...parsed,
			id,
			sessionId: context.sessionId ?? id,
			runId: context.runId,
		};
		return new Promise((resolve) => {
			/** 実行停止では収集途中の回答を破棄する。 */
			const cancel = () => finish({ action: "cancel", answers: {} });
			/** 取り消し通知の購読を解除し、カードを削除してから元の要求に回答を返す。 */
			const finish = (answer: QuestionAnswer) => {
				signal.removeEventListener("abort", cancel);
				this.pending.delete(id);
				this.publishRequests();
				resolve(answer);
			};
			this.pending.set(id, {
				request,
				finish,
				...(validate ? { validate } : {}),
			});
			signal.addEventListener("abort", cancel, { once: true });
			this.publishRequests();
		});
	};

	/** 不正入力は同じカードで修正できるよう、待機を継続する。 */
	respond(response: QuestionResponse): void {
		const pending = this.pending.get(response.questionId);
		const stale =
			!pending ||
			pending.request.sessionId !== response.sessionId ||
			pending.request.runId !== response.runId;
		if (stale) {
			throw new Error("この質問は既に終了しています。");
		}
		const invalidDecline =
			response.action === "decline" &&
			pending.request.allowDecline !== true;
		if (invalidDecline) {
			throw new Error("この質問では拒否を選べません。");
		}
		if (response.action !== "accept") {
			pending.finish({ action: response.action, answers: {} });
			return;
		}
		const error = answerError(pending, response.answers);
		if (error !== undefined) {
			pending.request = { ...pending.request, error };
			this.publishRequests();
			return;
		}
		pending.finish({ action: "accept", answers: response.answers });
	}

	/** 接続・実行の切り替え前に、待機中の全ての要求へ取り消しを返す。 */
	cancelAll(): void {
		for (const pending of [...this.pending.values()]) {
			pending.finish({ action: "cancel", answers: {} });
		}
	}
	/** 回答本文や検証関数を通信のスナップショットへ混入させない。 */
	private publishRequests(): void {
		this.publish(
			[...this.pending.values()].map((pending) => pending.request),
		);
	}
}

/** 質問にない回答項目や入力制約への違反を、バックエンド固有の検証より先に検出する。 */
function answerError(
	pending: PendingQuestion,
	answers: Record<string, string>,
): string | undefined {
	const fields = pending.request.fields;
	const unknownAnswer = Object.keys(answers).some(
		(id) => !fields.some((field) => field.id === id),
	);
	if (unknownAnswer) {
		return "質問に含まれない回答があります。";
	}
	for (const field of fields) {
		const value = Object.hasOwn(answers, field.id)
			? answers[field.id]!
			: "";
		const error = questionFieldError(field, value);
		if (error !== undefined) {
			return `${field.title}: ${error}`;
		}
	}
	return pending.validate?.(answers);
}
