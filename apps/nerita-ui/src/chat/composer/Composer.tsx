// 入力領域と送信・停止・設定操作をまとめる。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";
import type { ChatState } from "@nerita/shared/chatState";
import type { ComposerPart } from "@nerita/shared/composerContent";
import type { UiMessage } from "@nerita/shared/messages";
import { cn } from "cnfast";
import { ArrowUp } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { iconButtonClass } from "../messages/messageStyles";
import { SettingsTooltip } from "../SettingsTooltip";
import { ComposerInput } from "./ComposerInput";
import { ComposerSettings } from "./ComposerSettings";
import { useAttachmentDrop } from "./useAttachmentDrop";

/** 入力欄の下書き、編集・送信操作と実行中・入力制限の状態。 */
type ComposerProps = {
	bridge?: Bridge;
	parts: ComposerPart[];
	setDraft: (parts: ComposerPart[]) => void;
	submit: () => void;
	busy: boolean;
	available: boolean;
	locked?: boolean;
	state: ChatState;
	send: (message: UiMessage) => void;
};

/** 下書きの編集と送信・停止の操作をまとめる。 */
export function Composer(props: ComposerProps) {
	const {
		bridge,
		parts,
		setDraft,
		submit,
		busy,
		locked = false,
		state,
		send,
	} = props;
	const drop = useAttachmentDrop(state, locked, send);
	const [contextRequest, setContextRequest] = useState(0);
	const inputLocked = locked || drop.reading;
	const sendLabel = busy ? "フォローアップを送信" : "送信";
	return (
		<form
			{...drop.handlers}
			className={cn(
				"composer relative mx-[14px] mt-[8px] mb-[14px] rounded-[10px] border",
				"border-solid border-input-border bg-input p-[12px]",
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
					className={cn(
						"pointer-events-none absolute inset-0 z-20 flex items-center",
						"justify-center rounded-[10px] bg-input p-3 text-center text-input-text",
					)}
					role="status"
				>
					ドロップしてファイルを添付
				</div>
			)}
			{drop.error !== "" && (
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
			<ComposerFooter
				inputLocked={inputLocked}
				{...props}
				setContextRequest={setContextRequest}
				sendLabel={sendLabel}
				drop={drop}
			/>
		</form>
	);
}

/** 入力欄の下に表示する設定・送信・停止操作と、添付や入力制限の状態。 */
type ComposerFooterProps = {
	inputLocked: boolean;
	state: ChatState;
	send: (message: UiMessage) => void;
	setContextRequest: Dispatch<SetStateAction<number>>;
	busy: boolean;
	sendLabel: "フォローアップを送信" | "送信";
	drop: ReturnType<typeof useAttachmentDrop>;
	available: boolean;
	parts: ComposerPart[];
};

/** 設定操作と送信・停止ボタンを入力欄の下へ配置する。 */
function ComposerFooter({
	inputLocked,
	state,
	send,
	setContextRequest,
	busy,
	sendLabel,
	drop,
	available,
	parts,
}: ComposerFooterProps) {
	return (
		<div
			className={cn(
				"composer-footer mt-[12px] flex items-center justify-between gap-[10px]",
			)}
		>
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
								if (
									isNonEmptyString(state.sessionId) &&
									isNonEmptyString(state.runId)
								) {
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
						disabled={sendDisabled(drop, available, state, parts)}
					>
						<ArrowUp size={18} aria-hidden="true" />
					</button>
				</SettingsTooltip>
			</div>
		</div>
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
		!isNonEmptyString(state.sessionId) ||
		!parts.some((part) => part.text.trim() !== "")
	);
}

/** 添付可能な状態でのみ、Host のファイル選択を開く操作を渡す。 */
function attachmentAction(
	state: ChatState,
	locked: boolean,
	send: (message: UiMessage) => void,
) {
	if (
		!isNonEmptyString(state.sessionId) ||
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
