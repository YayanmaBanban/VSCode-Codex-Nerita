// 入力欄の下に添付・使用量・接続中の設定を順に配置する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { cn } from "cnfast";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { BackendSettingsSurface } from "../../contributions/BackendSettingsSurface";
import { ContributionSlot } from "../../contributions/ContributionSlot";
import { Attachments } from "./Attachments";
import { ContextPickerTrigger } from "./ContextPickerTrigger";
import { ContextUsage } from "./ContextUsage";

/** 設定・使用量・添付の表示状態と、設定要求の送信・参照メニューを開く操作。 */
type ComposerSettingsProps = {
	state: ChatState;
	send: (message: UiMessage) => void;
	onOpenContext?: (() => void) | undefined;
};

/** 設定項目を Host から受け取り、変更要求を検証済みのメッセージで送る。 */
export function ComposerSettings({
	state,
	send,
	onOpenContext,
}: ComposerSettingsProps) {
	const connected = settingsConnected(state);
	const disabled =
		!connected ||
		state.configPending ||
		state.run === "running" ||
		state.run === "cancelling";
	/** 操作は現在の会話 ID と一意な要求 ID を添えて送る。 */
	const change = (configId: string, value: string) => {
		if (isNonEmptyString(state.sessionId) && !disabled) {
			send({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId: state.sessionId,
				configId,
				value,
			});
		}
	};
	return (
		<div className="composer-settings min-w-0">
			{state.uiContributions && (
				<div className="flex flex-wrap items-center gap-[6px]">
					<ContributionSlot
						name="model.header"
						contributions={state.uiContributions}
						disabled={disabled}
						onChange={change}
					/>
				</div>
			)}
			<ComposerAttachments
				state={state}
				disabled={disabled}
				send={send}
			/>
			<div
				className={cn(
					"settings-toolbar flex flex-wrap items-center gap-x-[6px] gap-y-[4px]",
				)}
				aria-label="モデル設定"
			>
				<ContextPickerTrigger
					disabled={!connected}
					onOpen={onOpenContext}
				/>
				<ContextUsage
					key={state.sessionId ?? "disconnected"}
					usage={state.usage}
				/>
				{state.uiContributions && (
					<>
						<ContributionSlot
							name="composer.toolbar"
							contributions={state.uiContributions}
							disabled={disabled}
							onChange={change}
						/>
						<BackendSettingsSurface
							contributions={state.uiContributions}
							disabled={disabled}
							onChange={change}
						/>
						<ContributionSlot
							name="status"
							contributions={state.uiContributions}
							disabled={disabled}
							onChange={change}
						/>
					</>
				)}
			</div>
		</div>
	);
}

/** 添付を含むチャット状態と、操作の無効化・要求の送信。 */
type ComposerAttachmentsProps = {
	state: ChatState;
	disabled: boolean;
	send: (message: UiMessage) => void;
};

/** 添付を表示し、開く・削除する操作に対応した要求を Host へ送る。 */
function ComposerAttachments({
	state,
	disabled,
	send,
}: ComposerAttachmentsProps) {
	return (
		<Attachments
			files={state.attachments}
			disabled={disabled}
			onOpen={(attachmentId) =>
				send({
					type: "attachment/open",
					requestId: crypto.randomUUID(),
					sessionId: state.sessionId!,
					attachmentId,
				})
			}
			onRemove={(attachmentId) =>
				send({
					type: "attachment/remove",
					requestId: crypto.randomUUID(),
					sessionId: state.sessionId!,
					attachmentId,
				})
			}
		/>
	);
}

/** 設定を操作できる接続と会話があるか確認する。 */
function settingsConnected(state: ChatState) {
	return (
		(state.connection === "ready" ||
			(state.piAccount !== null &&
				state.connection === "auth-required")) &&
		!!isNonEmptyString(state.sessionId) &&
		!state.sessionPending
	);
}
