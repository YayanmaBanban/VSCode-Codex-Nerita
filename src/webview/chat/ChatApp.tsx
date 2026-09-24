// チャットの入力・逐次応答・接続状態と承認要求を表示する。
import { useRef } from "react";
import { useFollowConversation } from "./messages/useFollowConversation";
import { AnimatePresence } from "motion/react";
import type { Bridge } from "../vscodeBridge";
import { ChatConversation } from "./ChatConversation";
import { useChat } from "./useChat";
import { useChatView } from "./useChatView";
import { ConnectionHeader } from "./connection/ConnectionHeader";
import { Composer } from "./composer/Composer";
import { NotificationCard } from "./NotificationCard";
import { usePromptSubmission } from "./composer/usePromptSubmission";
import "./chat.css";
import { SessionPanel } from "./sessions/SessionPanel";
import { useSessionPanel } from "./sessions/useSessionPanel";
import { ChatSearchBar } from "./search/ChatSearchBar";
import { useChatSearch } from "./search/useChatSearch";
import { AgentViewer } from "./agents/AgentViewer";
import { useAgentViewer } from "./agents/useAgentViewer";
import { type ChatState } from "@/shared/chatState";

/** 差し替え可能な Bridge を使って実環境と Storybook で同じ UI を動かす。 */
export function ChatApp({ bridge }: { bridge: Bridge }) {
	const {
		windowsSandbox,
		backend,
		draft,
		draftParts,
		setDraft,
		editor,
		toggleEditor,
		conversation,
		sidebarLocation,
		selectSidebar,
	} = useChatView(bridge);
	const { state, requestError, send } = useChat(bridge);
	const agentViewer = useAgentViewer(bridge, state.sessionId);
	const search = useChatSearch(conversation);
	const sessionPanel = useSessionPanel(send);
	const submission = usePromptSubmission(
		bridge,
		state,
		draft,
		() => setDraft(""),
		send,
		draftParts,
	);
	const bottom = useRef<HTMLDivElement>(null);
	const busy = state.run === "running" || state.run === "cancelling";
	const available = chatAvailable(state, busy, submission);
	useFollowConversation(
		conversation,
		state.sessionId,
		search.open || !!agentViewer.agent,
	);
	return (
		<main className="chat-app m-auto flex h-dvh min-h-[360px] max-w-[1350px] flex-col">
			<ConnectionHeader
				windowsSandbox={windowsSandbox}
				backend={backend}
				sidebarLocation={sidebarLocation}
				onSelectSidebar={selectSidebar}
				state={state}
				editor={editor}
				onToggleEditor={toggleEditor}
				requestError={requestError}
				available={available}
				send={send}
				sessionsOpen={sessionPanel.open}
				onToggleSessions={sessionPanel.toggle}
			/>
			<div className="relative flex min-h-0 flex-1 overflow-x-clip">
				{agentViewer.agent && (
					<AgentViewer
						viewer={agentViewer}
						state={state}
						send={send}
					/>
				)}
				<div
					className={
						agentViewer.agent
							? "hidden"
							: "flex min-w-0 flex-1 flex-col"
					}
					inert={sessionPanel.open && sessionPanel.compact}
				>
					<ChatSearchBar search={search} />
					<ChatConversation
						state={state}
						busy={busy}
						send={send}
						conversation={conversation}
						bottom={bottom}
						onOpenAgent={agentViewer.open}
					/>
					{submission.notice && (
						<NotificationCard
							key={submission.notice.id}
							onClose={submission.dismissNotice}
							backgroundColor="var(--vscode-inputValidation-errorBackground, light-dark(#fbe9e7, #482b2e))"
						>
							{submission.notice.text}
						</NotificationCard>
					)}
					<Composer
						bridge={bridge}
						parts={draftParts}
						setDraft={setDraft}
						submit={submission.submit}
						locked={submission.locked}
						busy={busy}
						available={submission.available}
						state={state}
						send={send}
					/>
				</div>
				<AnimatePresence initial={false}>
					{sessionPanel.open && (
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
		</main>
	);
}

/** 実行と設定の待機中は会話操作を無効にする。 */
function chatAvailable(
	state: ChatState,
	busy: boolean,
	submission: {
		locked: boolean;
		available: boolean;
		submit: () => void;
		notice: { id: string; text: string } | null;
		dismissNotice: () => void;
	},
) {
	return (
		state.connection === "ready" &&
		!busy &&
		!submission.locked &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending
	);
}
