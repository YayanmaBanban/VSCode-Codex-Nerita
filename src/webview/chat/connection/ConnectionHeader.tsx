// セッションタイトル・表示先・接続操作と、認証やエラーの案内を表示する。
import { cn } from "cnfast";
import type { ChatState } from "../../../shared/chatState";
import type { BackendId } from "../../../shared/backend";
import type { UiMessage } from "../../../shared/messages";
import { List, MessageSquareText, Maximize2, Minimize2 } from "lucide-react";
import { AuthenticationNotice } from "./AuthenticationNotice";
import { ConnectionButton } from "./ConnectionButton";
import { SettingsTooltip } from "../SettingsTooltip";
import { PersonalityOptions } from "../personality/PersonalityOptions";
import type { SidebarLocation } from "../../../shared/sidebar";

/** 認証案内とエラー通知に共通する枠・色・余白。 */
const noticeClass =
	"mx-[14px] mt-[12px] mb-0 rounded-[8px] border border-solid border-alert-border bg-alert p-[12px] leading-[1.7]";
const iconClass =
	"inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover";

/** 狭い表示でも操作を残し、長いセッションタイトルだけを省略する。 */
export function ConnectionHeader({
	backend,
	state,
	requestError,
	available,
	send,
	sessionsOpen,
	onToggleSessions,
	editor,
	onToggleEditor,
	sidebarLocation,
	onSelectSidebar,
}: {
	backend?: BackendId | undefined;
	state: ChatState;
	requestError: string | null;
	available: boolean;
	send: (message: UiMessage) => void;
	sessionsOpen: boolean;
	onToggleSessions: () => void;
	editor: boolean;
	onToggleEditor: () => void;
	sidebarLocation?: SidebarLocation;
	onSelectSidebar?: (location: SidebarLocation) => void;
}) {
	const title = sessionHeaderTitle(state);
	const viewLabel = editor ? "サイドバーへ戻る" : "エディタグループへ移動";
	return (
		<>
			<header className="chat-header flex min-w-0 items-center gap-[6px] border-0 border-b border-solid border-message-border px-[12px] py-[10px]">
				<h1 className="m-0 min-w-0 flex-1 truncate text-[12px] font-medium tracking-normal">
					{title}
				</h1>
				<ConnectionButton state={state} send={send} />
				<div className="flex shrink-0 items-center gap-[2px]">
					<SettingsTooltip content="新しいチャット">
						<button
							type="button"
							className={iconClass}
							aria-label="新しいチャット"
							disabled={!available}
							onClick={() =>
								send({
									type: "session/new",
									requestId: crypto.randomUUID(),
								})
							}
						>
							<MessageSquareText size={16} aria-hidden="true" />
						</button>
					</SettingsTooltip>
					<SettingsTooltip content="セッション一覧">
						<button
							type="button"
							id="session-list-toggle"
							className={iconClass}
							aria-label="セッション一覧"
							disabled={!state.sessionCapabilities.list}
							aria-expanded={sessionsOpen}
							aria-controls="session-panel"
							onClick={onToggleSessions}
						>
							<List size={16} aria-hidden="true" />
						</button>
					</SettingsTooltip>
					<SettingsTooltip content={viewLabel}>
						<button
							type="button"
							className={iconClass}
							aria-label={viewLabel}
							onClick={onToggleEditor}
						>
							{editor ? (
								<Minimize2 size={16} aria-hidden="true" />
							) : (
								<Maximize2 size={16} aria-hidden="true" />
							)}
						</button>
					</SettingsTooltip>
					<PersonalityOptions
						backend={backend}
						sidebarLocation={sidebarLocation}
						onSelectSidebar={onSelectSidebar}
						state={state}
						send={send}
						error={requestError}
					/>
				</div>
			</header>
			{(state.error || requestError) && (
				<div role="alert" className={cn("error-banner", noticeClass)}>
					{requestError || state.error}
				</div>
			)}
			{(state.connection === "auth-required" ||
				state.connection === "authenticating") && (
				<AuthenticationNotice
					key={state.connection}
					state={state}
					send={send}
					noticeClass={noticeClass}
				/>
			)}
		</>
	);
}

/** 現在のセッションに表示するタイトルを選ぶ。 */
function sessionHeaderTitle(state: ChatState) {
	return (
		state.sessionTitle?.trim() ||
		state.sessions
			.find((session) => session.sessionId === state.sessionId)
			?.title?.trim() ||
		"新規チャット"
	);
}
