// 履歴とアーカイブ共通の削除操作に、取り消せないことを伝える確認を挟む。
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Trash2 } from "lucide-react";
import type { UiMessage } from "../../../shared/messages";
import type { SessionSummary } from "../../../shared/sessionHistory";

/** 確認ボタンを押した時だけ対象セッションの永久削除を要求する。 */
export function SessionDelete({
	session,
	disabled,
	send,
}: {
	session: SessionSummary;
	disabled: boolean;
	send: (message: UiMessage) => void;
}) {
	const title = session.title?.trim() || "無題のセッション";
	return (
		<AlertDialog.Root>
			<AlertDialog.Trigger
				disabled={disabled}
				aria-label={`${title}を削除`}
				title="セッションを削除"
				className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-red-500 hover:bg-red-500/10 focus-visible:outline-offset-[-2px]"
			>
				<Trash2 size={14} aria-hidden="true" />
			</AlertDialog.Trigger>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
				<AlertDialog.Popup
					className="fixed top-1/2 left-1/2 z-50 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-solid border-menu-border bg-menu p-[20px] text-menu-text shadow-[0_8px_32px_#0004]"
					onKeyDown={(event) => event.stopPropagation()}
				>
					<AlertDialog.Title className="m-0 text-[14px] font-semibold">
						セッションを削除しますか？
					</AlertDialog.Title>
					<AlertDialog.Description className="my-[14px] text-[12px] leading-[1.7] [overflow-wrap:anywhere]">
						「{title}」を削除します。この操作は取り消せません。
					</AlertDialog.Description>
					<div className="flex flex-wrap justify-end gap-[8px]">
						<AlertDialog.Close className="rounded-[6px] px-[12px] py-[8px] text-[12px]">
							キャンセル
						</AlertDialog.Close>
						<AlertDialog.Close
							disabled={disabled}
							className="rounded-[6px] border-0 bg-red-500/10 px-[12px] py-[8px] text-[12px] font-semibold text-red-500 hover:bg-red-500/20"
							onClick={() =>
								send({
									type: "session/delete",
									requestId: crypto.randomUUID(),
									sessionId: session.sessionId,
								})
							}
						>
							セッションを削除
						</AlertDialog.Close>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
