// 送信受付だけで入力ロックを解除し、失敗した下書きは編集可能なまま残す。
import { useEffect, useRef, useState } from "react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import type { Bridge } from "../../vscodeBridge";
import {
	promptContent,
	type ComposerPart,
} from "../../../shared/composerContent";

/** 個別要求の結果と短時間の通知を入力欄へ接続する。 */
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
	latest.current = clearDraft;
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
		if (state.connection !== "ready" && pending.current) {
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
	/** 同一イベント内での連打も参照値で防ぐ。下書きは受付後だけ消す。 */
	const submit = () => {
		if (
			!available ||
			pending.current ||
			!draft.trim() ||
			!state.sessionId
		) {
			return;
		}
		const requestId = crypto.randomUUID();
		const codeReferences = [
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
		const sessionReferences = [
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
					.map((ref) => [
						JSON.stringify([ref.sessionId, ref.mode]),
						ref,
					]),
			).values(),
		];
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
			...(sessionReferences.length ? { sessionReferences } : {}),
			...(changeScopes.length ? { changeScopes } : {}),
			...(codeReferences.length ? { codeReferences } : {}),
		});
	};
	return {
		locked,
		available,
		submit,
		notice,
		dismissNotice: () => setNotice(null),
	};
}
