// 通常チャットの接続操作と、独立した DLC 作業画面への入口を表示する。
import { ConnectionHeader } from "./connection/ConnectionHeader";
import { ConnectionButton } from "./connection/ConnectionButton";
import type { ChatWorkspaceHeader } from "./ChatWorkspace";

/** DLC を開いても通常チャットの会話・入力・接続設定は切り替えない。 */
export function ChatModeHeader({
	view,
	chat,
	available,
	sessionPanel,
}: ChatWorkspaceHeader) {
	return (
		<ConnectionHeader
			untrusted={view.untrusted}
			backend={view.backend}
			sidebarLocation={view.sidebarLocation}
			onSelectSidebar={view.selectSidebar}
			state={chat.state}
			editor={view.editor}
			onToggleEditor={view.toggleEditor}
			requestError={chat.requestError}
			available={available}
			send={chat.send}
			sessionsOpen={sessionPanel.open}
			onToggleSessions={sessionPanel.toggle}
			dlc={false}
			connectionControl={
				<div className="flex shrink-0 items-center gap-1">
					<ConnectionIndicator chat={chat} />
					<button
						type="button"
						onClick={() =>
							chat.send({
								type: "dlc/open",
								requestId: crypto.randomUUID(),
							})
						}
					>
						DLC
					</button>
				</div>
			}
		/>
	);
}

/** 接続済みの表示と、未接続時の再試行操作を共通ヘッダーへ渡す。 */
function ConnectionIndicator({ chat }: Pick<ChatWorkspaceHeader, "chat">) {
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
	return <ConnectionButton state={chat.state} send={chat.send} />;
}
