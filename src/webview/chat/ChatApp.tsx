// チャットの入力・逐次応答・接続状態と承認要求を表示する。
import { useEffect, useEffectEvent, useRef } from "react";
import type { Bridge } from "../vscodeBridge";
import { useChat } from "./useChat";
import { useChatView } from "./useChatView";
import { ConnectionHeader } from "./ConnectionHeader";
import { Activity } from "./Activity";
import { Messages } from "./Messages";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { RunStatusIcon } from "./RunStatusIcon";
import { Composer } from "./Composer";
import { NotificationCard } from "./NotificationCard";
import { usePromptSubmission } from "./usePromptSubmission";
import "./chat.css";
import { SessionPanel } from "./sessions/SessionPanel";
import { useSessionPanel } from "./sessions/useSessionPanel";
import { ChatSearchBar } from "./search/ChatSearchBar";
import { useChatSearch } from "./search/useChatSearch";

const runLabels = {
	idle: "",
	running: "",
	cancelling: "停止しています…",
	completed: "",
	cancelled: "停止しました",
	failed: "実行に失敗しました",
};
/** 差し替え可能な Bridge を使って実環境と Storybook で同じ UI を動かす。 */
export function ChatApp({ bridge }: { bridge: Bridge }) {
	const {
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
	const available =
		state.connection === "ready" &&
		!busy &&
		!submission.locked &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending;
	const followConversation = useEffectEvent(() => {
		if (!search.open) {
			bottom.current?.scrollIntoView({ block: "end" });
		}
	});
	useEffect(() => {
		followConversation();
	}, [state.messages, state.permissions]);
	return (
		<main className="chat-app m-auto flex h-dvh min-h-[360px] max-w-[1350px] flex-col">
			<ConnectionHeader
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
			<div className="relative flex min-h-0 flex-1">
				<div
					className="flex min-w-0 flex-1 flex-col"
					inert={sessionPanel.open && sessionPanel.compact}
				>
					<ChatSearchBar search={search} />
					<section
						ref={conversation}
						className="conversation min-h-0 flex-1 overflow-y-auto px-[20px] py-[22px] [scrollbar-width:thin]"
						aria-label="会話"
					>
						{state.messages.length === 0 && (
							<div className="empty-state px-0 pt-[10vh] pb-[30px] text-center">
								<p className="text-[12px] text-muted">
									このワークスペースで作業します
								</p>
								<p className="text-[12px] leading-[1.7] text-muted [overflow-wrap:anywhere]">
									{state.cwd}
								</p>
							</div>
						)}
						<div
							role="log"
							aria-label="メッセージ"
							aria-live="polite"
							aria-relevant="additions text"
						>
							<Messages
								messages={state.messages}
								busy={busy}
								tools={state.tools}
								renderTool={(tool) => (
									<Activity
										key={String(tool.runId) + tool.id}
										state={{
											...state,
											tools: [tool],
											permissions: [],
										}}
										send={send}
									/>
								)}
							/>
						</div>
						<Activity state={{ ...state, tools: [] }} send={send} />
						{state.run === "running" && <ThinkingIndicator />}
						{runLabels[state.run] && (
							<p
								className="run-status my-2 flex items-center gap-1 text-[12px] text-muted"
								role="status"
							>
								{runLabels[state.run]}
								<RunStatusIcon
									kind={
										state.run === "failed"
											? "startled"
											: "loaf"
									}
								/>
							</p>
						)}
						<div ref={bottom} />
					</section>
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
				{sessionPanel.open && (
					<SessionPanel
						state={state}
						send={send}
						onClose={sessionPanel.close}
					/>
				)}
			</div>
		</main>
	);
}
