// 送信の受付・失敗・切断で入力ロックを解除し、失敗した下書きは編集可能なまま残す。
import { contentKey } from "./content";
/** 外部へ登録したコールバックから最新値を参照するための可変の参照先。 */
type Reference<T> = { current: T };
/** 直接指定した値と、前の状態から計算する更新処理を共通に扱う。 */
type SetStateAction<T> = T | ((previous: T) => T);
/** 状態の更新要求を受け取る通知関数。呼び出し元は戻り値を利用しない。 */
type Dispatch<T> = (value: T) => void;
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";

import type { ChatState } from "@nerita/shared/chatState";

import {
	promptContent,
	type ComposerPart,
} from "@nerita/shared/composerContent";

import type { UiMessage } from "@nerita/shared/messages";
/** 送信先の会話・下書きと通知先。送信中も最新の接続状態を参照する。 */
type SubmissionInput = {
	bridge: Bridge;
	state: ChatState;
	draft: string;
	clearDraft: () => void;
	send: (message: UiMessage) => void;
	parts: ComposerPart[];
};

/** 送信の保留状態を会話へ結び付け、遅い受付で別の下書きを消さない。 */
export function usePromptSubmission(input: SubmissionInput) {
	return new PromptSubmission(input);
}

/** 送信の受付待ちと入力ロックを保持し、失敗時は送信対象だった下書きを編集可能なまま残す。 */
class PromptSubmission {
	private readonly input: SubmissionInput;
	locked = $state(false);
	notice = $state.raw<{ id: string; text: string } | null>(null);
	private readonly pending: Reference<string | null> = { current: null };
	private pendingScope = "";
	private pendingContent = "";
	/** 購読を入力欄の寿命へ結び付け、会話変更時に保留を解除する。 */
	constructor(input: SubmissionInput) {
		this.input = input;
		// Bridge の切り替えと画面の破棄に合わせ、送信結果を受け取る購読を解除する。
		$effect(() => input.bridge.subscribe(this.receive));
		// 外部の切断や会話変更でもロックを解放するため、送信イベントだけでは処理できない。
		$effect(() =>
			this.reconcileConnection(input.state.connection, this.scope),
		);
	}
	/** 送信先の会話と作業フォルダを識別する。 */
	private get scope() {
		return `${this.input.state.cwd}:${this.input.state.sessionId}`;
	}
	/** 設定と添付が確定し、連打の保留がない場合だけ送信できる。 */
	get available() {
		const state = this.input.state;
		const ready =
			state.connection === "ready" &&
			state.run !== "cancelling" &&
			!this.locked;
		const configured =
			ready && !state.sessionPending && !state.configPending;
		return configured && !state.attachmentPending;
	}
	/** 現在の送信失敗を通知し、次の送信で更新する。 */
	private readonly setNotice = (
		value: SetStateAction<{ id: string; text: string } | null>,
	) => {
		this.notice = typeof value === "function" ? value(this.notice) : value;
	};
	/** 送信した本文を記録して、受付時の下書きと比較する。 */
	private readonly setLocked = (value: SetStateAction<boolean>) => {
		this.locked = typeof value === "function" ? value(this.locked) : value;
		if (this.locked) {
			this.pendingScope = this.scope;
			this.pendingContent = contentKey(this.input.parts);
		}
	};
	/** 利用者が閉じた通知を入力欄から外す。 */
	readonly dismissNotice = () => {
		this.notice = null;
	};
	/** 検証済みの本文を、現在の会話へ一度だけ送る。 */
	readonly submit = () =>
		createPromptSubmitter(
			this.available,
			this.pending,
			this.input.draft,
			this.input.state,
			this.input.parts,
			this.setNotice,
			this.setLocked,
			this.input.send,
		)();
	/** 保留した要求への受付と失敗だけを反映する。 */
	private readonly receive: Parameters<Bridge["subscribe"]>[0] = (
		message,
	) => {
		const reply =
			message.type === "prompt/accepted" ||
			message.type === "request/failed";
		if (!reply || message.requestId !== this.pending.current) {
			return;
		}
		this.pending.current = null;
		this.locked = false;
		if (this.pendingScope !== this.scope) {
			return;
		}
		if (message.type === "prompt/accepted") {
			if (this.pendingContent === contentKey(this.input.parts)) {
				this.input.clearDraft();
			}
			this.notice = null;
			return;
		}
		this.notice = { id: message.requestId, text: message.error };
	};
	/** 切断や会話変更でロックを解除し、下書きは残す。 */
	private reconcileConnection(
		connection: ChatState["connection"],
		scope: string,
	) {
		const pending = this.pending.current;
		if (!isNonEmptyString(pending)) {
			return;
		}
		if (connection === "ready" && scope === this.pendingScope) {
			return;
		}
		this.notice =
			scope === this.pendingScope
				? {
						id: pending,
						text: "接続が切れたため、送信を確認できませんでした。",
					}
				: null;
		this.pending.current = null;
		this.locked = false;
	}
}

/** 連打を防ぎ、送信が受け付けられるまで下書きを保持する。 */
function createPromptSubmitter(
	available: boolean,
	pending: Reference<string | null>,
	draft: string,
	state: ChatState,
	parts: ComposerPart[],
	setNotice: Dispatch<SetStateAction<{ id: string; text: string } | null>>,
	setLocked: Dispatch<SetStateAction<boolean>>,
	send: (message: UiMessage) => void,
) {
	return () => {
		if (!available) {
			return;
		}
		if (isNonEmptyString(pending.current)) {
			return;
		}
		if (draft.trim() === "") {
			return;
		}
		if (!isNonEmptyString(state.sessionId)) {
			return;
		}
		const requestId = crypto.randomUUID();
		const codeReferences = promptCodeReferences(parts);
		const changeScopes = [
			...new Set(
				parts.flatMap(
					(part) =>
						part.references?.flatMap(({ path }) =>
							path.kind === "changes" ? [path.scope] : [],
						) ?? [],
				),
			),
		];
		const sessionReferences = promptSessionReferences(parts);
		const content = promptContent(draft, parts);
		const error = promptLimitError(
			content.text.length,
			codeReferences.length,
			sessionReferences.length,
		);
		if (error !== undefined) {
			setNotice({ id: requestId, text: error });
			return;
		}
		pending.current = requestId;
		setLocked(true);
		setNotice(null);
		send({
			type: "prompt/send",
			requestId,
			sessionId: state.sessionId,
			...content,
			...(sessionReferences.length > 0 ? { sessionReferences } : {}),
			...(changeScopes.length > 0 ? { changeScopes } : {}),
			...(codeReferences.length > 0 ? { codeReferences } : {}),
		});
	};
}

/** 参照件数と Markdown 変換後の文字数を確認し、送信できない理由を返す。 */
function promptLimitError(
	characters: number,
	codeReferences: number,
	sessionReferences: number,
): string | undefined {
	if (codeReferences > 20) {
		return "コード参照は20件までにしてください。";
	}
	if (sessionReferences > 5) {
		return "参照するセッションは5件までにしてください。";
	}
	if (characters > 100_000) {
		return "本文は100,000文字以内にしてください。";
	}
	return undefined;
}

/** 参照する会話と参照方式の重複を取り除く。 */
function promptSessionReferences(parts: ComposerPart[]) {
	return [
		...new Map(
			parts
				.flatMap(
					(part) =>
						part.references?.flatMap(({ path }) =>
							path.kind === "session"
								? [
										{
											sessionId: path.sessionId,
											mode: path.mode,
										},
									]
								: [],
						) ?? [],
				)
				.map((ref) => [JSON.stringify([ref.sessionId, ref.mode]), ref]),
		).values(),
	];
}

/** コード参照を位置ごとに重複なく収集する。 */
function promptCodeReferences(parts: ComposerPart[]) {
	return [
		...new Map(
			parts
				.flatMap(
					(part) =>
						part.references?.flatMap(({ path }) =>
							path.kind === "file" && path.range
								? [{ uri: path.uri, range: path.range }]
								: [],
						) ?? [],
				)
				.map((reference) => [JSON.stringify(reference), reference]),
		).values(),
	];
}
