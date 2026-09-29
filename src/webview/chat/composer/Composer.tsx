// 入力領域と送信・停止・設定操作をまとめる。
import { cn } from "cnfast";
import { useState } from "react";
import { SettingsTooltip } from "../SettingsTooltip";
import { ArrowUp } from "lucide-react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import type { ComposerPart } from "../../../shared/composerContent";
import { ComposerInput } from "./ComposerInput";
import { ComposerSettings } from "./ComposerSettings";
import { iconButtonClass } from "../messages/messageStyles";
import type { Bridge } from "../../vscodeBridge";
import { useAttachmentDrop } from "./useAttachmentDrop";

/** 下書きの編集と既存の送信・停止操作を接続する。 */
export function Composer({
	bridge,
	parts,
	setDraft,
	submit,
	busy,
	available,
	locked = false,
	state,
	send,
}: {
	bridge?: Bridge;
	parts: ComposerPart[];
	setDraft: (parts: ComposerPart[]) => void;
	submit: () => void;
	busy: boolean;
	available: boolean;
	locked?: boolean;
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const drop = useAttachmentDrop(state, locked, send);
	const [contextRequest, setContextRequest] = useState(0);
	const inputLocked = locked || drop.reading;
	const sendLabel = busy ? "フォローアップを送信" : "送信";
	return (
		<form
			{...drop.handlers}
			className={cn(
				"composer relative mx-[14px] mt-[8px] mb-[14px] rounded-[10px] border border-solid border-input-border bg-input p-[12px]",
				drop.active && "outline-2 outline-focus",
			)}
			onSubmit={(event) => {
				event.preventDefault();
				if (!drop.reading) {
					submit();
				}
			}}
		>
			{drop.active && (
				<div
					className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[10px] bg-input p-3 text-center text-input-text"
					role="status"
				>
					ドロップしてファイルを添付
				</div>
			)}
			{drop.error && (
				<p role="alert" className="text-[12px] text-tool-error">
					{drop.error}
				</p>
			)}
			<div inert={inputLocked} aria-busy={inputLocked}>
				<ComposerInput
					contextRequest={contextRequest}
					onAttach={attachmentAction(state, inputLocked, send)}
					collaborationModes={
						state.uiContributions?.surface === "codex"
					}
					completionScope={`${state.connection}:${state.cwd}:${state.sessionId}`}
					bridge={bridge}
					locked={inputLocked}
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
				<div className="min-w-0 flex-1" inert={inputLocked}>
					<ComposerSettings
						state={state}
						send={send}
						onOpenContext={() =>
							setContextRequest((value) => value + 1)
						}
					/>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{busy && (
						<SettingsTooltip content="停止">
							<button
								type="button"
								className={cn(
									iconButtonClass,
									"stop-button bg-[#bd3948]",
								)}
								aria-label="停止"
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
								<span
									className="size-[14px] rounded-[2px] bg-white"
									aria-hidden="true"
								/>
							</button>
						</SettingsTooltip>
					)}
					<SettingsTooltip content={sendLabel}>
						<button
							type="submit"
							className={cn(
								iconButtonClass,
								"send-button bg-[#2563b8]",
							)}
							aria-label={sendLabel}
							disabled={sendDisabled(
								drop,
								available,
								state,
								parts,
							)}
						>
							<ArrowUp size={18} aria-hidden="true" />
						</button>
					</SettingsTooltip>
				</div>
			</div>
		</form>
	);
}

/** 添付の読み込み中、接続やセッションが利用できない場合、下書きが空の場合は送信を無効にする。 */
function sendDisabled(
	drop: ReturnType<typeof useAttachmentDrop>,
	available: boolean,
	state: ChatState,
	parts: ComposerPart[],
) {
	return (
		drop.reading ||
		!available ||
		!state.sessionId ||
		!parts.some((part) => part.text.trim())
	);
}

/** 添付可能な状態でのみ、Host のファイル選択を開く操作を渡す。 */
function attachmentAction(
	state: ChatState,
	locked: boolean,
	send: (message: UiMessage) => void,
) {
	if (
		!state.sessionId ||
		state.connection !== "ready" ||
		state.sessionPending ||
		state.configPending ||
		state.attachmentPending ||
		!state.attachmentsSupported ||
		state.run === "running" ||
		state.run === "cancelling" ||
		locked
	) {
		return undefined;
	}
	const sessionId = state.sessionId;
	return () =>
		send({
			type: "attachment/add",
			requestId: crypto.randomUUID(),
			sessionId,
		});
}
