// セッションタイトル・表示先・接続操作と、認証やエラーの案内を表示する。
import type { ChatState, UiMessage } from "../../shared/messages";
import {
	List,
	MessageSquareText,
	Maximize2,
	Minimize2,
	Ellipsis,
} from "lucide-react";
import { ConnectionButton } from "./ConnectionButton";
import { SettingsTooltip } from "./SettingsTooltip";

/** 認証案内とエラー通知に共通する枠・色・余白。 */
const noticeClass =
	"mx-[14px] mt-[12px] mb-0 rounded-[6px] border border-solid border-alert-border bg-alert p-[12px] leading-[1.7]";
const iconClass =
	"inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover";

/** 狭い表示でも操作を残し、長いセッションタイトルだけを省略する。 */
export function ConnectionHeader({
	state,
	requestError,
	available,
	send,
	sessionsOpen,
	onToggleSessions,
	editor,
	onToggleEditor,
}: {
	state: ChatState;
	requestError: string | null;
	available: boolean;
	send: (message: UiMessage) => void;
	sessionsOpen: boolean;
	onToggleSessions: () => void;
	editor: boolean;
	onToggleEditor: () => void;
}) {
	const title =
		state.sessionTitle?.trim() ||
		state.sessions
			.find((session) => session.sessionId === state.sessionId)
			?.title?.trim() ||
		"新規チャット";
	const viewLabel = editor ? "サイドバーへ戻る" : "エディタグループへ移動";
	return (
		<>
			<header className="chat-header flex min-w-0 items-center gap-[6px] border-0 border-b border-solid border-message-border px-[12px] py-[10px]">
				<h1
					className="m-0 min-w-0 flex-1 truncate text-[12px] font-medium tracking-normal"
					title={title}
				>
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
					<SettingsTooltip content="オプション（準備中）">
						<button
							type="button"
							className={iconClass}
							aria-label="オプション（準備中）"
							disabled
						>
							<Ellipsis size={16} aria-hidden="true" />
						</button>
					</SettingsTooltip>
				</div>
			</header>
			{(state.error || requestError) && (
				<div role="alert" className={`error-banner ${noticeClass}`}>
					{requestError || state.error}
				</div>
			)}
			{state.connection === "auth-required" && (
				<section
					className={`auth-card ${noticeClass}`}
					aria-label="認証"
				>
					<p>
						ChatGPTにログインするか、VS
						Codeの起動環境に設定したAPIキーを使用します。
					</p>
					{state.authMethods.map((method) => (
						<button
							key={method.id}
							className="m-[3px]"
							onClick={() =>
								send({
									type: "auth/start",
									requestId: crypto.randomUUID(),
									methodId: method.id,
								})
							}
						>
							{method.name}
						</button>
					))}
				</section>
			)}
			{state.connection === "authenticating" && (
				<p className={`auth-card ${noticeClass}`}>
					ブラウザでログインを完了してください。最大3分間待機します。
				</p>
			)}
		</>
	);
}
