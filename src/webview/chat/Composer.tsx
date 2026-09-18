// 入力領域と送信・停止・設定操作をまとめる。
import { SendHorizontal, SquareStop } from "lucide-react";
import type { ChatState, UiMessage } from "../../shared/messages";
import type { ComposerPart } from "../../shared/composerContent";
import { ComposerInput } from "./ComposerInput";
import { ComposerSettings } from "./ComposerSettings";
import { iconButtonClass } from "./messageStyles";
/** 下書きの編集と既存の送信・停止操作を接続する。 */
export function Composer({
	parts,
	setDraft,
	submit,
	busy,
	available,
	locked = false,
	state,
	send,
}: {
	parts: ComposerPart[];
	setDraft: (parts: ComposerPart[]) => void;
	submit: () => void;
	busy: boolean;
	available: boolean;
	locked?: boolean;
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	return (
		<form
			className="composer mx-[14px] mt-[8px] mb-[14px] rounded-[10px] border border-solid border-input-border bg-input p-[12px]"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div inert={locked} aria-busy={locked}>
				<ComposerInput
					locked={locked}
					attachments={state.attachments}
					skills={state.skills}
					followUp={
						state.run === "running" && state.connection === "ready"
					}
					parts={parts}
					onChange={setDraft}
					onSubmit={submit}
				/>
			</div>
			<div className="composer-footer mt-[12px] flex items-center justify-between gap-[10px]">
				<span
					id="composer-help"
					className="text-[12px] text-muted [@media(max-width:360px)]:max-w-[145px] [@media(max-width:360px)]:leading-[1.7]"
				>
					Enter で送信 · Shift+Enter で改行（コード内は Enter で改行）
				</span>
				<div className="flex shrink-0 items-center gap-2">
					{busy && (
						<button
							type="button"
							className={`${iconButtonClass} stop-button bg-[#bd3948]`}
							aria-label="停止"
							title="停止"
							disabled={state.run === "cancelling"}
							onClick={() => {
								if (state.sessionId && state.runId) {
									send({
										type: "prompt/cancel",
										requestId: crypto.randomUUID(),
										sessionId: state.sessionId,
										runId: state.runId,
									});
								}
							}}
						>
							<SquareStop size={18} aria-hidden="true" />
						</button>
					)}
					<button
						type="submit"
						className={`${iconButtonClass} send-button bg-[#2563b8]`}
						aria-label={busy ? "フォローアップを送信" : "送信"}
						title={busy ? "フォローアップを送信" : "送信"}
						disabled={
							!available ||
							!state.sessionId ||
							!parts.some((part) => part.text.trim())
						}
					>
						<SendHorizontal size={18} aria-hidden="true" />
					</button>
				</div>
			</div>
			<div inert={locked}>
				<ComposerSettings state={state} send={send} />
			</div>
		</form>
	);
}
