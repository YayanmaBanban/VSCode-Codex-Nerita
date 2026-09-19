// 右ペインに作業フォルダとセッション履歴を表示する。
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { Archive, List } from "lucide-react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import { taskActive } from "../../../shared/asyncTask";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { SessionItem } from "./SessionItem";

/** 一覧を開いた時だけ相対時刻を更新し、閉じる操作へフォーカスする。 */
export function SessionPanel({
	state,
	send,
	onClose,
	compact,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
	onClose: () => void;
	compact: boolean;
}) {
	const present = useIsPresent();
	const reduceMotion = useReducedMotion();
	// 広い画面では会話欄の幅も追従させ、狭い画面では重ねたままスライドする。
	const collapsed = {
		transform: "translateX(100%)",
		marginRight: compact ? 0 : -350,
	};
	const [now, setNow] = useState(Date.now);
	const close = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		close.current?.focus();
		const timer = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);
	const disabled =
		state.connection !== "ready" ||
		state.sessionPending ||
		state.configPending ||
		state.attachmentPending ||
		state.run === "running" ||
		state.run === "cancelling" ||
		state.asyncTasks.some(taskActive);
	const capabilities = state.sessionCapabilities;
	return (
		<motion.aside
			initial={collapsed}
			animate={{ transform: "translateX(0%)", marginRight: 0 }}
			exit={collapsed}
			transition={{
				duration: reduceMotion ? 0 : 0.22,
				ease: [0.22, 1, 0.36, 1],
			}}
			inert={!present}
			aria-hidden={!present}
			id="session-panel"
			aria-label="セッション一覧"
			className={clsx(
				"absolute inset-y-0 right-0 z-20 flex w-[350px] max-w-full shrink-0 flex-col",
				"border-0 border-l border-solid border-panel-border bg-menu text-menu-text shadow-[-8px_0_24px_#0002]",
				"[@media(min-width:760px)]:static [@media(min-width:760px)]:shadow-none",
			)}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<SessionPanelHeader state={state} close={close} onClose={onClose} />
			{capabilities.unarchive && (
				<div
					className="flex gap-[8px] px-[12px] py-[8px]"
					role="group"
					aria-label="履歴の表示範囲"
				>
					{[false, true].map((archived) => (
						<button
							key={String(archived)}
							type="button"
							className={clsx(
								"inline-flex items-center",
								"gap-[6px]",
								"text-[12px]",
								"aria-pressed:border-focus aria-pressed:font-semibold aria-pressed:underline aria-pressed:underline-offset-4",
							)}
							aria-pressed={state.sessionsArchived === archived}
							disabled={
								state.sessionPending ||
								state.connection !== "ready"
							}
							onClick={() =>
								send({
									type: "session/list",
									archived,
									requestId: crypto.randomUUID(),
								})
							}
						>
							{archived ? (
								<Archive size={14} aria-hidden="true" />
							) : (
								<List size={14} aria-hidden="true" />
							)}
							{archived ? "アーカイブ" : "履歴"}
						</button>
					))}
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto p-[8px] [scrollbar-width:thin]">
				{state.sessionsError && (
					<div
						role="alert"
						className="m-[4px] rounded-[6px] border border-solid border-alert-border bg-alert p-[10px] text-[12px] leading-[1.7]"
					>
						{state.sessionsError}
						{capabilities.list && (
							<button
								type="button"
								className="mt-[8px] block text-[12px]"
								disabled={
									state.sessionsLoading ||
									state.sessionPending
								}
								onClick={() =>
									send({
										type: "session/list",
										requestId: crypto.randomUUID(),
									})
								}
							>
								再試行
							</button>
						)}
					</div>
				)}
				{state.sessionPending && (
					<p
						role="status"
						className="mx-[8px] text-[12px] text-muted"
					>
						セッションを更新しています…
					</p>
				)}
				{!state.sessions.length &&
					!state.sessionsLoading &&
					!state.sessionsError && (
						<p className="px-[12px] py-[24px] text-center text-[12px] text-muted">
							このフォルダのセッションはありません
						</p>
					)}
				<ul className="m-0 list-none p-0" aria-label="セッション履歴">
					{state.sessions.map((session) => (
						<SessionItem
							key={session.sessionId}
							session={session}
							selected={session.sessionId === state.sessionId}
							now={now}
							disabled={disabled}
							capabilities={capabilities}
							send={send}
						/>
					))}
				</ul>
				{state.sessionsNextCursor !== null && (
					<button
						type="button"
						className="mx-[12px] my-[8px] text-[12px]"
						disabled={state.sessionsLoading || state.sessionPending}
						onClick={() =>
							send({
								type: "session/list",
								more: true,
								requestId: crypto.randomUUID(),
							})
						}
					>
						さらに読み込む
					</button>
				)}
			</div>
		</motion.aside>
	);
}
