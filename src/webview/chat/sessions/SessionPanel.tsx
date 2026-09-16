// 右ペインに作業フォルダとセッション履歴を表示する。
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { ChatState, UiMessage } from "../../../shared/messages";
import { taskActive } from "../../../shared/asyncTask";
import { SessionItem, sessionActionClass as actionClass } from "./SessionItem";

/** 一覧を開いた時だけ相対時刻を更新し、閉じる操作へフォーカスする。 */
export function SessionPanel({
	state,
	send,
	onClose,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
	onClose: () => void;
}) {
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
		<aside
			id="session-panel"
			aria-label="セッション一覧"
			className="absolute inset-y-0 right-0 z-20 flex w-[350px] max-w-full shrink-0 flex-col border-0 border-l border-solid border-panel-border bg-menu text-menu-text shadow-[-8px_0_24px_#0002] [@media(min-width:760px)]:static [@media(min-width:760px)]:shadow-none"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<header className="border-0 border-b border-solid border-panel-border px-[16px] py-[14px]">
				<div className="flex items-center justify-between gap-[8px]">
					<h2 className="m-0 text-[13px] font-semibold">
						セッション一覧
					</h2>
					<button
						ref={close}
						type="button"
						className={actionClass}
						aria-label="セッション一覧を閉じる"
						title="閉じる"
						onClick={onClose}
					>
						<X size={16} aria-hidden="true" />
					</button>
				</div>
				<div className="mt-[8px] flex items-start gap-[8px]">
					<span
						className="min-w-0 flex-1 break-all font-editor text-[11px] leading-[1.6] text-muted"
						title={state.cwd ?? undefined}
					>
						{state.cwd ?? "ワークスペース未接続"}
					</span>
					{state.sessionsLoading && (
						<span
							role="progressbar"
							aria-label="セッション一覧を取得中"
							className="mt-[1px] inline-flex shrink-0 text-link"
						>
							<LoaderCircle
								size={15}
								className="motion-safe:animate-spin"
								aria-hidden="true"
							/>
						</span>
					)}
				</div>
			</header>
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
							className="text-[12px] aria-pressed:border-focus aria-pressed:font-semibold aria-pressed:underline aria-pressed:underline-offset-4"
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
							{archived ? "アーカイブ済み" : "通常の履歴"}
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
								className="mt-[8px] block text-[11px]"
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
						className="mx-[8px] text-[11px] text-muted"
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
		</aside>
	);
}
