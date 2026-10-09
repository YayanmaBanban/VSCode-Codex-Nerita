// 入力と送信受付の状態を会話の描画から分離し、入力ロックだけを親へ通知する。
import { useLayoutEffect } from "react";
import type { Bridge } from "@nerita/shared/bridge";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { NotificationCard } from "../NotificationCard";
import { Composer } from "./Composer";
import { useComposerDraft } from "./useComposerDraft";
import { usePromptSubmission } from "./usePromptSubmission";

/** 入力以外の状態を受け取り、送信待ちの間だけヘッダー操作も無効にする。 */
export function ChatComposer({
	bridge,
	state,
	send,
	busy,
	visible,
	onLockChange,
}: {
	bridge: Bridge;
	state: ChatState;
	send: (message: UiMessage) => void;
	busy: boolean;
	visible: boolean;
	onLockChange: (locked: boolean) => void;
}) {
	const { parts, draft, setDraft } = useComposerDraft(bridge);
	const submission = usePromptSubmission(
		bridge,
		state,
		draft,
		() => setDraft(""),
		send,
		parts,
	);
	useLayoutEffect(() => {
		onLockChange(submission.locked);
		return () => onLockChange(false);
	}, [onLockChange, submission.locked]);
	// DLC では入力欄の DOM を外すが、下書きと送信受付の購読はモードを戻すまで保持する。
	if (!visible) {
		return null;
	}
	return (
		<>
			{submission.notice && (
				<NotificationCard
					key={submission.notice.id}
					onClose={submission.dismissNotice}
					backgroundColor="var(--nerita-input-validation-error-background)"
				>
					{submission.notice.text}
				</NotificationCard>
			)}
			<Composer
				bridge={bridge}
				state={state}
				send={send}
				busy={busy}
				parts={parts}
				setDraft={setDraft}
				submit={submission.submit}
				locked={submission.locked}
				available={submission.available}
			/>
		</>
	);
}
