// チャットの入力・逐次応答・接続状態と承認要求を表示する。
import { useEffect, useRef, useState } from "react";
import { SendHorizontal, SquareStop } from "lucide-react";
import type { Bridge } from "../vscodeBridge";
import { useChat } from "./useChat";
import { ConnectionHeader } from "./ConnectionHeader";
import { Activity } from "./Activity";
import { Messages } from "./Messages";
import { CubeLoader } from "./CubeLoader";
import { ComposerSettings } from "./ComposerSettings";
import "./chat.css";
import "./composer.css";

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
	const { state, requestError, send } = useChat(bridge);
	const [draft, setDraft] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const composing = useRef(false);
	const bottom = useRef<HTMLDivElement>(null);
	const busy = state.run === "running" || state.run === "cancelling";
	const available =
		state.connection === "ready" &&
		!busy &&
		!submitted &&
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
		<main className="chat-app">
			<ConnectionHeader
				state={state}
				requestError={requestError}
				available={available}
				send={send}
			/>
			<section className="conversation" aria-label="会話">
				{state.messages.length === 0 && (
					<div className="empty-state">
						<div className="empty-mark" aria-hidden="true">
							⌘
						</div>
						<h2>ここから、一緒に。</h2>
						<p>
							コードについて質問したり、
							<br />
							取り組みたい変更を伝えてください。
						</p>
						<span className="empty-hint">
							このワークスペースで作業します
						</span>
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
					<p className="run-status" role="status">
						{runLabels[state.run]}
					</p>
				)}
				{state.run === "cancelled" && (
					<p className="muted">
						再接続すると新しい会話を開始できます。
					</p>
				)}
				<div ref={bottom} />
			</section>
			<form
				className="composer"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<label className="sr-only" htmlFor="prompt">
					Codexへのメッセージ
				</label>
				<textarea
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
				<div className="composer-footer">
					<span>Enter で送信 · Shift+Enter で改行</span>
					{busy ? (
						<button
							type="button"
							className="icon-button stop-button"
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
							className="icon-button send-button"
							aria-label="送信"
							title="送信"
							disabled={!available || !draft.trim()}
						>
							<SendHorizontal size={18} aria-hidden="true" />
						</button>
					)}
				</div>
				<ComposerSettings state={state} send={send} />
			</form>
		</main>
	);
}
