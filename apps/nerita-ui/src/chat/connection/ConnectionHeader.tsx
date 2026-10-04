// セッションタイトル・表示先・接続操作と、認証やエラーの案内を表示する。

import type { BackendId } from "@nerita/shared/backend";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import type { SidebarLocation } from "@nerita/shared/sidebar";
import { cn } from "cnfast";
import { List, Maximize2, MessageSquareText, Minimize2 } from "lucide-react";
import { SettingsTooltip } from "../SettingsTooltip";
import { PersonalityOptions } from "../personality/PersonalityOptions";
import { AuthenticationNotice } from "./AuthenticationNotice";
import { ConnectionButton } from "./ConnectionButton";
import { ActionNotice, noticeClass } from "../../ui/ActionNotice";

const iconClass =
	"inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover";

/** 接続・エラー・履歴の表示状態と、会話や表示先を切り替える操作。 */
type ConnectionHeaderProps = {
	untrusted?: boolean;
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
};

/** 狭い表示でも操作を残し、長いセッションタイトルだけを省略する。 */
export function ConnectionHeader(props: ConnectionHeaderProps) {
	const { state, requestError, send, editor } = props;
	const title = sessionHeaderTitle(state);
	const viewLabel = editor ? "サイドバーへ戻る" : "エディタグループへ移動";
	return (
		<>
			<header
				className={cn(
					"chat-header flex min-w-0 items-center gap-[6px] border-0 border-b",
					"border-solid border-message-border px-[12px] py-[10px]",
				)}
			>
				<h1
					className={cn(
						"m-0 min-w-0 flex-1 truncate text-[12px] font-medium tracking-normal",
					)}
				>
					{title}
				</h1>
				<ConnectionButton state={state} send={send} />
				<ChatHeaderActions {...props} viewLabel={viewLabel} />
			</header>
			{(requestError ||
				(state.connection !== "auth-required" && state.error)) && (
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
				/>
			)}
			{props.backend === "pi" && props.untrusted && (
				<ActionNotice
					label="ワークスペースの信頼"
					title="ワークスペースが未信頼"
					description={
						"セッションは、グローバル領域（.pi\\agent\\sessions）に保存されます"
					}
					actions={[
						{
							id: "trust",
							name: "信頼する",
							onClick: () =>
								send({
									type: "workspace/manageTrust",
									requestId: crypto.randomUUID(),
								}),
						},
					]}
				/>
			)}
		</>
	);
}

/** 会話・履歴・表示先・設定の操作と、操作可否を判定する状態。 */
type ChatHeaderActionsProps = {
	available: boolean;
	send: (message: UiMessage) => void;
	state: ChatState;
	sessionsOpen: boolean;
	onToggleSessions: () => void;
	viewLabel: "サイドバーへ戻る" | "エディタグループへ移動";
	onToggleEditor: () => void;
	editor: boolean;
	backend?: undefined | "codex" | "pi";
	sidebarLocation?: undefined | "primary" | "secondary";
	onSelectSidebar?: ((location: SidebarLocation) => void) | undefined;
	requestError: null | string;
};

/** 新規会話・履歴一覧・表示先と個別設定の操作をまとめる。 */
function ChatHeaderActions(props: ChatHeaderActionsProps) {
	const {
		available,
		send,
		state,
		sessionsOpen,
		onToggleSessions,
		viewLabel,
		onToggleEditor,
		editor,
		requestError,
	} = props;
	return (
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
			<PersonalityOptions {...props} error={requestError} />
		</div>
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
