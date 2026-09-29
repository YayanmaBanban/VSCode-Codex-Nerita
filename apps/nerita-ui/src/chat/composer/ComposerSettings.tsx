// 入力欄の下に添付・使用量・接続中の設定を指定順で配置する。
import { ContextPickerTrigger } from "./ContextPickerTrigger";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { ContextUsage } from "./ContextUsage";
import { Attachments } from "./Attachments";
import { ContributionSlot } from "../../contributions/ContributionSlot";
import { BackendSettingsSurface } from "../../contributions/BackendSettingsSurface";

/** 設定項目を Host から受け取り、変更要求を検証済みのメッセージで送る。 */
export function ComposerSettings({
	state,
	send,
	onOpenContext,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
	onOpenContext?: (() => void) | undefined;
}) {
	const connected = settingsConnected(state);
	const disabled =
		!connected ||
		state.configPending ||
		state.run === "running" ||
		state.run === "cancelling";
	/** 操作は現在の会話 ID と一意な要求 ID を添えて送る。 */
	const change = (configId: string, value: string) => {
		if (state.sessionId && !disabled) {
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
			<div
				className="settings-toolbar flex flex-wrap items-center gap-x-[6px] gap-y-[4px]"
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

/** 設定を操作できる接続と会話があるか確認する。 */
function settingsConnected(state: ChatState) {
	return (
		(state.connection === "ready" ||
			(state.piAccount !== null &&
				state.connection === "auth-required")) &&
		!!state.sessionId &&
		!state.sessionPending
	);
}
