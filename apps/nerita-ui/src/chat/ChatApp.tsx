// チャットの入力・逐次応答・接続状態と承認要求を表示する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";
import { type ChatState } from "@nerita/shared/chatState";
import { type UiMessage } from "@nerita/shared/messages";
import { cn } from "cnfast";
import { AnimatePresence } from "motion/react";
import { useRef, useState, type RefObject } from "react";
import { AgentViewer } from "./agents/AgentViewer";
import { useAgentViewer } from "./agents/useAgentViewer";
import "./chat.css";
import { ChatConversation } from "./ChatConversation";
import { ChatComposer } from "./composer/ChatComposer";
import { ChatModeHeader } from "./ChatModeHeader";
import { useFollowConversation } from "./messages/useFollowConversation";
import { NotificationCard } from "./NotificationCard";
import { ChatSearchBar } from "./search/ChatSearchBar";
import { useChatSearch } from "./search/useChatSearch";
import { SessionPanel } from "./sessions/SessionPanel";
import { useSessionPanel } from "./sessions/useSessionPanel";
import { useChat } from "./useChat";
import { useChatView } from "./useChatView";
import { ToolOutputBridge } from "./tools/ToolOutputView";
import { useDlc } from "./dlc/useDlc";
import "./dlc/dlc.css";

/** Host とのメッセージ送受信に使うブリッジ。 */
type ChatAppProps = { bridge: Bridge };

/** 差し替え可能なブリッジを使って実環境と Storybook で同じ UI を動かす。 */
export function ChatApp({ bridge }: ChatAppProps) {
	const view = useChatView(bridge);
	const { conversation } = view;
	const chat = useChat(bridge);
	const { state, send } = chat;
	const dlc = useDlc(bridge);
	const agentViewer = useAgentViewer(bridge, state.sessionId);
	const search = useChatSearch(conversation);
	const sessionPanel = useSessionPanel(send);
	const [submissionLocked, setSubmissionLocked] = useState(false);
	const bottom = useRef<HTMLDivElement>(null);
	const busy = state.run === "running" || state.run === "cancelling";
	const available = chatAvailable(state, busy, submissionLocked);
	useFollowConversation(
		conversation,
		state.sessionId,
		search.open || !!agentViewer.agent,
	);
	return (
		<ToolOutputBridge value={bridge}>
			<main
				className={cn(
					"chat-app m-auto flex h-dvh min-h-[360px] max-w-[1350px] flex-col",
				)}
			>
				<ChatModeHeader
					view={view}
					chat={chat}
					dlc={dlc}
					available={available}
					sessionPanel={sessionPanel}
				/>
				<ChatWorkspace
					agentViewer={agentViewer}
					state={state}
					send={send}
					sessionPanel={sessionPanel}
					search={search}
					busy={busy}
					conversation={conversation}
					bottom={bottom}
					onSubmissionLock={setSubmissionLocked}
					bridge={bridge}
					dlc={dlc.mode === "dlc"}
				/>
			</main>
		</ToolOutputBridge>
	);
}

/** 会話・検索・履歴・下書きの状態と、表示や送信に使う操作・DOM 参照。 */
type ChatWorkspaceProps = {
	dlc: boolean;
	agentViewer: ReturnType<typeof useAgentViewer>;
	state: ChatState;
	send: (message: UiMessage) => void;
	sessionPanel: ReturnType<typeof useSessionPanel>;
	search: ReturnType<typeof useChatSearch>;
	busy: boolean;
	conversation: RefObject<HTMLElement | null>;
	bottom: RefObject<HTMLDivElement | null>;
	onSubmissionLock: (locked: boolean) => void;
	bridge: Bridge;
};

/** 会話・子スレッド・入力欄と履歴パネルを配置する。 */
function ChatWorkspace(props: ChatWorkspaceProps) {
	const { agentViewer, state, send, sessionPanel, search } = props;
	const sessionsVisible = sessionPanel.open && !props.dlc;
	return (
		<div className="relative flex min-h-0 flex-1 overflow-x-clip">
			{agentViewer.agent && (
				<AgentViewer viewer={agentViewer} state={state} send={send} />
			)}
			<div
				className={cn(
					agentViewer.agent
						? "hidden"
						: "flex min-w-0 flex-1 flex-col",
				)}
				inert={sessionsVisible && sessionPanel.compact}
			>
				<ChatSearchBar search={search} />
				<ChatConversation {...props} onOpenAgent={agentViewer.open} />
				{state.connection === "auth-required" &&
					isNonEmptyString(state.error) && (
						<AuthenticationFailureNotification
							key={state.error}
							message={state.error}
						/>
					)}
				<ChatComposer
					bridge={props.bridge}
					state={state}
					send={send}
					busy={props.busy}
					visible={!props.dlc}
					onLockChange={props.onSubmissionLock}
				/>
			</div>
			<AnimatePresence initial={false}>
				{sessionsVisible && (
					<SessionPanel
						key="sessions"
						compact={sessionPanel.compact}
						state={state}
						send={send}
						onClose={sessionPanel.close}
					/>
				)}
			</AnimatePresence>
		</div>
	);
}

/** 認証失敗の通知に表示する文言。 */
type AuthenticationFailureNotificationProps = { message: string };

/** 認証の再試行時に通知を画面から外し、同じエラーでも次回の失敗時には表示する。 */
function AuthenticationFailureNotification({
	message,
}: AuthenticationFailureNotificationProps) {
	const [dismissed, setDismissed] = useState(false);
	return dismissed ? null : (
		<NotificationCard
			onClose={() => setDismissed(true)}
			duration={8000}
			backgroundColor="var(--nerita-input-validation-error-background)"
		>
			{message}
		</NotificationCard>
	);
}

/** 実行と設定の待機中は会話操作を無効にする。 */
function chatAvailable(
	state: ChatState,
	busy: boolean,
	submissionLocked: boolean,
) {
	return (
		state.connection === "ready" &&
		!busy &&
		!submissionLocked &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending
	);
}
