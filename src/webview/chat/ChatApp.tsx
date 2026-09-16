// チャットの入力・逐次応答・接続状態と承認要求を表示する。
import { useEffect, useRef, useState } from "react";
import { SendHorizontal, SquareStop } from "lucide-react";
import type { Bridge } from "../vscodeBridge";
import { useChat } from "./useChat";
import { useChatView } from "./useChatView";
import { ConnectionHeader } from "./ConnectionHeader";
import { Activity } from "./Activity";
import { Messages } from "./Messages";
import { CubeLoader } from "./CubeLoader";
import { ComposerSettings } from "./ComposerSettings";
import { iconButtonClass } from "./messageStyles";
import "./chat.css";
import { SessionPanel } from "./sessions/SessionPanel";
import { useSessionPanel } from "./sessions/useSessionPanel";

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
	const { draft, setDraft, editor, toggleEditor, conversation } =
		useChatView(bridge);
	const { state, requestError, send } = useChat(bridge);
	const sessionPanel = useSessionPanel(send);
	const [submitted, setSubmitted] = useState(false);
	const composing = useRef(false);
	const bottom = useRef<HTMLDivElement>(null);
	const busy = state.run === "running" || state.run === "cancelling";
	const available =
		state.connection === "ready" &&
		!busy &&
		!submitted &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending;
	useEffect(() => {
		setSubmitted(false);
	}, [state.revision, requestError]);
	useEffect(() => {
		bottom.current?.scrollIntoView({ block: "end" });
	}, [state.messages, state.permissions]);
	/** IME 確定と二重送信を防ぎ、テキストだけを Host に渡す。 */
	const submit = () => {
		if (!available || !draft.trim() || !state.sessionId) {
			return;
		}
		setSubmitted(true);
		send({
			type: "prompt/send",
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			text: draft.trim(),
		});
		setDraft("");
	};
	return (
		<main className="chat-app m-auto flex h-dvh min-h-[360px] max-w-[1350px] flex-col">
			<ConnectionHeader
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
						{state.run === "running" && <CubeLoader />}
						{runLabels[state.run] && (
							<p
								className="run-status text-[12px] text-muted"
								role="status"
							>
								{runLabels[state.run]}
							</p>
						)}
						<div ref={bottom} />
					</section>
					<form
						className="composer mx-[14px] mt-[8px] mb-[14px] rounded-[10px] border border-solid border-input-border bg-input p-[12px]"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<label className="sr-only" htmlFor="prompt">
							Codexへのメッセージ
						</label>
						<textarea
							className="w-full min-h-[65px] max-h-[240px] resize-y border-0 bg-transparent text-input-text leading-[1.7] placeholder:text-input-placeholder"
							id="prompt"
							value={draft}
							placeholder="Codexに依頼する…"
							maxLength={100_000}
							rows={3}
							onChange={(event) => setDraft(event.target.value)}
							onCompositionStart={() => {
								composing.current = true;
							}}
							onCompositionEnd={() => {
								composing.current = false;
							}}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing &&
									!composing.current &&
									event.keyCode !== 229
								) {
									event.preventDefault();
									submit();
								}
							}}
						/>
						<div className="composer-footer mt-[12px] flex items-center justify-between gap-[10px]">
							<span className="text-[12px] text-muted [@media(max-width:360px)]:max-w-[145px] [@media(max-width:360px)]:leading-[1.7]">
								Enter で送信 · Shift+Enter で改行
							</span>
							{busy ? (
								<button
									type="button"
									className={`${iconButtonClass} stop-button bg-[#bd3948]`}
									aria-label="停止"
									title="停止"
									disabled={state.run === "cancelling"}
									onClick={() => {
										if (state.sessionId && state.runId) {
											send({
												type: "prompt/cancel",
												requestId: crypto.randomUUID(),
												sessionId: state.sessionId,
												runId: state.runId,
											});
										}
									}}
								>
									<SquareStop size={18} aria-hidden="true" />
								</button>
							) : (
								<button
									type="submit"
									className={`${iconButtonClass} send-button bg-[#2563b8]`}
									aria-label="送信"
									title="送信"
									disabled={
										!available ||
										!state.sessionId ||
										!draft.trim()
									}
								>
									<SendHorizontal
										size={18}
										aria-hidden="true"
									/>
								</button>
							)}
						</div>
						<ComposerSettings state={state} send={send} />
					</form>
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
