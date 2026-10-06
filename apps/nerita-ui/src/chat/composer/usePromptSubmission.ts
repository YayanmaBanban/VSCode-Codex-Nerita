// 送信の受付・失敗・切断で入力ロックを解除し、失敗した下書きは編集可能なまま残す。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";
import type { ChatState } from "@nerita/shared/chatState";
import {
	promptContent,
	type ComposerPart,
} from "@nerita/shared/composerContent";
import type { UiMessage } from "@nerita/shared/messages";
import {
	useLayoutEffect,
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type RefObject,
	type SetStateAction,
} from "react";

/** 送信結果に応じて入力ロック・下書き・エラー通知を更新する。 */
export function usePromptSubmission(
	bridge: Bridge,
	state: ChatState,
	draft: string,
	clearDraft: () => void,
	send: (message: UiMessage) => void,
	parts: ComposerPart[] = [],
) {
	const pending = useRef<string | null>(null);
	const [locked, setLocked] = useState(false);
	const [notice, setNotice] = useState<{
		id: string;
		text: string;
	} | null>(null);
	const latest = useRef(clearDraft);
	useLayoutEffect(() => {
		latest.current = clearDraft;
	}, [clearDraft]);
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (
					(message.type !== "prompt/accepted" &&
						message.type !== "request/failed") ||
					message.requestId !== pending.current
				) {
					return;
				}
				pending.current = null;
				setLocked(false);
				if (message.type === "prompt/accepted") {
					latest.current();
					setNotice(null);
					return;
				}
				setNotice({
					id: message.requestId,
					text: message.error,
				});
			}),
		[bridge],
	);
	useEffect(() => {
		if (state.connection !== "ready" && isNonEmptyString(pending.current)) {
			setNotice({
				id: pending.current,
				text: "接続が切れたため、送信を確認できませんでした。",
			});
			pending.current = null;
			setLocked(false);
		}
	}, [state.connection]);
	const available =
		state.connection === "ready" &&
		state.run !== "cancelling" &&
		!locked &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending;
	/** 待機中の要求 ID を参照して連打を防ぐ。下書きは受付後だけ消す。 */
	const submit = () =>
		createPromptSubmitter(
			available,
			pending,
			draft,
			state,
			parts,
			setNotice,
			setLocked,
			send,
		)();
	return {
		locked,
		available,
		submit,
		notice,
		dismissNotice: () => setNotice(null),
	};
}

/** 連打を防ぎ、送信が受け付けられるまで下書きを保持する。 */
function createPromptSubmitter(
	available: boolean,
	pending: RefObject<string | null>,
	draft: string,
	state: ChatState,
	parts: ComposerPart[],
	setNotice: Dispatch<SetStateAction<{ id: string; text: string } | null>>,
	setLocked: Dispatch<SetStateAction<boolean>>,
	send: (message: UiMessage) => void,
) {
	return () => {
		if (
			!available ||
			isNonEmptyString(pending.current) ||
			draft.trim() === "" ||
			!isNonEmptyString(state.sessionId)
		) {
			return;
		}
		const requestId = crypto.randomUUID();
		const codeReferences = promptCodeReferences(parts);
		if (codeReferences.length > 20) {
			setNotice({
				id: requestId,
				text: "コード参照は20件までにしてください。",
			});
			return;
		}
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
		if (sessionReferences.length > 5) {
			setNotice({
				id: requestId,
				text: "参照するセッションは5件までにしてください。",
			});
			return;
		}
		pending.current = requestId;
		setLocked(true);
		setNotice(null);
		send({
			type: "prompt/send",
			requestId,
			sessionId: state.sessionId,
			...promptContent(draft, parts),
			...(sessionReferences.length > 0 ? { sessionReferences } : {}),
			...(changeScopes.length > 0 ? { changeScopes } : {}),
			...(codeReferences.length > 0 ? { codeReferences } : {}),
		});
	};
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
