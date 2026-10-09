// 表示モードを接続領域で切り替え、DLC の操作画面と共通チャットを対応付ける。
import type { DlcView } from "@nerita/shared/dlc/contracts";
import { ConnectionHeader } from "./connection/ConnectionHeader";
import { ConnectionButton } from "./connection/ConnectionButton";
import { DlcRunInfo } from "./dlc/DlcRunInfo";
import type { useChat } from "./useChat";
import type { useChatView } from "./useChatView";
import type { useSessionPanel } from "./sessions/useSessionPanel";

type ChatModeHeaderProps = {
	view: ReturnType<typeof useChatView>;
	chat: ReturnType<typeof useChat>;
	dlc: DlcView;
	available: boolean;
	sessionPanel: ReturnType<typeof useSessionPanel>;
};

export function ChatModeHeader({
	view,
	chat,
	dlc,
	available,
	sessionPanel,
}: ChatModeHeaderProps) {
	const managed = dlc.mode === "dlc";
	return (
		<>
			<ConnectionHeader
				untrusted={view.untrusted}
				backend={managed ? dlc.backend : view.backend}
				sidebarLocation={view.sidebarLocation}
				onSelectSidebar={view.selectSidebar}
				state={chat.state}
				editor={view.editor}
				onToggleEditor={view.toggleEditor}
				requestError={chat.requestError}
				available={available && !managed}
				send={chat.send}
				sessionsOpen={sessionPanel.open}
				onToggleSessions={sessionPanel.toggle}
				dlc={managed}
				{...(managed
					? { title: dlc.selected?.title ?? "DLC の実行ログ" }
					: {})}
				connectionControl={<ChatConnectionMode chat={chat} dlc={dlc} />}
			/>
			{managed && (
				<DlcRunInfo view={dlc} state={chat.state} send={chat.send} />
			)}
		</>
	);
}

/** モード切替は実行を止めず、DLC の接続操作は操作画面から要求する。 */
function ChatConnectionMode({
	chat,
	dlc,
}: Pick<ChatModeHeaderProps, "chat" | "dlc">) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<ConnectionIndicator chat={chat} dlc={dlc} />
			<div
				role="group"
				aria-label="作業モード"
				className="chat-mode-switch"
			>
				{["chat", "dlc"].map((mode) => (
					<button
						key={mode}
						type="button"
						aria-pressed={dlc.mode === mode}
						onClick={() => {
							if (mode === "dlc") {
								chat.send({
									type: "dlc/open",
									requestId: crypto.randomUUID(),
								});
							} else {
								chat.send({
									type: "ui/setMode",
									requestId: crypto.randomUUID(),
									mode: "chat",
								});
							}
						}}
					>
						{mode === "chat" ? "Chat" : "DLC"}
					</button>
				))}
			</div>
		</div>
	);
}
function ConnectionIndicator({
	chat,
	dlc,
}: Pick<ChatModeHeaderProps, "chat" | "dlc">) {
	if (chat.state.connection === "ready") {
		return (
			<span
				role="status"
				aria-label="接続済み"
				data-connection="ready"
				className="size-[6px] rounded-full bg-menu-check"
			/>
		);
	}
	if (dlc.mode === "chat") {
		return <ConnectionButton state={chat.state} send={chat.send} />;
	}
	return (
		<span role="status" className="text-[11px] text-muted">
			{chat.state.connection === "connecting" ? "接続中" : "接続を確認"}
		</span>
	);
}
