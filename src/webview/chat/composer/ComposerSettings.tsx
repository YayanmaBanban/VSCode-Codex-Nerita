// 入力欄の下に添付・使用量・接続中の設定を指定順で配置する。
import { Plus } from "lucide-react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import { ContextUsage } from "./ContextUsage";
import { Attachments } from "./Attachments";
import { ContributionSlot } from "../../contributions/ContributionSlot";
import { BackendSettingsSurface } from "../../contributions/BackendSettingsSurface";

/** 接続中の設定は Host の宣言で描画し、操作は既存の検証済み通信へ戻す。 */
export function ComposerSettings({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
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
		<div className="composer-settings mt-[10px] border-0 border-t border-solid border-panel-border pt-[8px]">
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
				<button
					type="button"
					className="attach-button flex border-0 bg-transparent p-[5px]"
					aria-label="ファイルを添付"
					title="ファイルを添付"
					disabled={
						disabled ||
						state.attachmentPending ||
						!state.attachmentsSupported
					}
					onClick={() =>
						send({
							type: "attachment/add",
							requestId: crypto.randomUUID(),
							sessionId: state.sessionId!,
						})
					}
				>
					<Plus size={16} aria-hidden="true" />
				</button>
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
