// 通常チャットの接続操作と、独立した DLC 作業画面への入口を表示する。
import { ConnectionHeader } from "./connection/ConnectionHeader";
import { ConnectionButton } from "./connection/ConnectionButton";
import type { ChatWorkspaceHeader } from "./ChatWorkspace";
import { SettingsTooltip } from "./SettingsTooltip";

/** DLC エディタの開閉をモード選択に反映し、通常チャットの会話・入力・接続設定を保つ。 */
export function ChatModeHeader({
	view,
	chat,
	available,
	sessionPanel,
	mode,
}: ChatWorkspaceHeader & { mode: "chat" | "dlc" }) {
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
			connectionControl={<ConnectionControl chat={chat} mode={mode} />}
		/>
	);
}

/** 接続操作と、DLC エディタを開閉するモードボタンをまとめる。 */
function ConnectionControl({
	chat,
	mode,
}: Pick<ChatWorkspaceHeader, "chat"> & { mode: "chat" | "dlc" }) {
	/** 選択モードに対応するエディタの開閉を Host に依頼する。 */
	function selectMode(target: "chat" | "dlc") {
		const requestId = crypto.randomUUID();
		chat.send(
			target === "dlc"
				? { type: "dlc/open", requestId }
				: { type: "ui/setMode", requestId, mode: "chat" },
		);
	}

	return (
		<div className="flex shrink-0 items-center gap-1">
			<ConnectionIndicator chat={chat} />
			<div
				role="group"
				aria-label="作業モード"
				className="chat-mode-switch"
				data-mode={mode}
			>
				<span aria-hidden="true" className="chat-mode-indicator" />
				{(["chat", "dlc"] as const).map((target) => (
					<SettingsTooltip
						key={target}
						content={
							target === "chat"
								? "チャットモード"
								: "ライフサイクルモード"
						}
					>
						<button
							type="button"
							aria-pressed={mode === target}
							onClick={() => selectMode(target)}
						>
							{target === "chat" ? "Chat" : "DLC"}
						</button>
					</SettingsTooltip>
				))}
			</div>
		</div>
	);
}

/** 接続済みのときは表示せず、それ以外は接続状態と再試行操作を共通ヘッダーへ渡す。 */
function ConnectionIndicator({ chat }: Pick<ChatWorkspaceHeader, "chat">) {
	if (chat.state.connection === "ready") {
		return null;
	}
	return <ConnectionButton state={chat.state} send={chat.send} />;
}
