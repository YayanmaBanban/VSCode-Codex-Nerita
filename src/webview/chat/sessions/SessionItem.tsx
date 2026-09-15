// 一つのセッションの概要と独立した操作ボタンを表示する。
import { Archive, GitFork, Pencil } from "lucide-react";
import type { UiMessage } from "../../../shared/messages";
import type {
	SessionSummary,
	SessionCapabilities,
} from "../../../shared/sessionHistory";
import { relativeTime } from "./relativeTime";
/** 履歴ペインで使う小さなアイコンボタン。 */
export const sessionActionClass =
	"inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted hover:bg-menu-hover focus-visible:outline-offset-[-2px]";
/** セッションを開く操作と補助操作を別々のボタンで提供する。 */
export function SessionItem({
	session,
	selected,
	now,
	disabled,
	capabilities,
	send,
}: {
	session: SessionSummary;
	selected: boolean;
	now: number;
	disabled: boolean;
	capabilities: SessionCapabilities;
	send: (message: UiMessage) => void;
}) {
	const title = session.title?.trim() || "無題のセッション";
	return (
		<li
			key={session.sessionId}
			className={`session-item mb-[4px] rounded-[7px] border border-solid ${selected ? "border-focus bg-menu-hover" : "border-transparent bg-menu"} hover:bg-menu-hover hover:brightness-110 focus-within:bg-menu-hover`}
		>
			<button
				type="button"
				className="block w-full rounded-[6px] border-0 bg-transparent px-[12px] pt-[12px] pb-[5px] text-left focus-visible:outline-offset-[-2px]"
				disabled={disabled || !capabilities.load}
				aria-current={selected ? "true" : undefined}
				aria-label={`${title}を開く`}
				title={title}
				onClick={() =>
					send({
						type: "session/load",
						requestId: crypto.randomUUID(),
						sessionId: session.sessionId,
					})
				}
			>
				<span className="block truncate text-[13px] leading-[1.6]">
					{title}
				</span>
				<span className="mt-[4px] block text-[11px] text-muted">
					{relativeTime(session.updatedAt, now)}
				</span>
			</button>
			<div className="flex items-center justify-end gap-[2px] px-[8px] pb-[6px]">
				<button
					type="button"
					className={sessionActionClass}
					aria-label={`${title}の名前を変更`}
					title="名前を変更"
				>
					<Pencil size={14} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={sessionActionClass}
					disabled={disabled || !capabilities.delete}
					aria-label={`${title}をアーカイブ`}
					title="アーカイブ"
					onClick={() =>
						send({
							type: "session/delete",
							requestId: crypto.randomUUID(),
							sessionId: session.sessionId,
						})
					}
				>
					<Archive size={14} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={sessionActionClass}
					disabled={
						disabled || !capabilities.fork || !capabilities.load
					}
					aria-label={`${title}をフォーク`}
					title="フォーク"
					onClick={() =>
						send({
							type: "session/fork",
							requestId: crypto.randomUUID(),
							sessionId: session.sessionId,
						})
					}
				>
					<GitFork size={14} aria-hidden="true" />
				</button>
			</div>
		</li>
	);
}
