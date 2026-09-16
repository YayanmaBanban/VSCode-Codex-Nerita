// メッセージと、同じターンへの移動・回答コピーを表示する。
import { type ReactNode, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Copy } from "lucide-react";
import type { ChatMessage, ToolSummary } from "../../shared/messages";
import { MessageText } from "./MessageText";
import { TextType } from "./TextType";
import { iconButtonClass, messageFocusClass } from "./messageStyles";

/** DOM の参照で移動先を解決し、別のチャット画面への干渉を防ぐ。 */
export function Messages({
	messages,
	busy,
	tools = [],
	renderTool,
}: {
	messages: ChatMessage[];
	busy: boolean;
	tools?: ToolSummary[];
	renderTool?: (tool: ToolSummary) => ReactNode;
}) {
	const elements = useRef(new Map<string, HTMLElement>());
	const [copyStatus, setCopyStatus] = useState<{
		id: string;
		text: string;
	} | null>(null);
	/** 対象をフォーカスし、送信文の先頭か返信の末尾を表示する。 */
	const jump = (id: string, end: boolean) => {
		const element = elements.current.get(id + (end ? ":end" : ""));
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({
			block: end ? "end" : "start",
			behavior: "instant",
		});
	};
	/** コピーの成功・失敗を支援技術にも通知する。 */
	const copy = async (message: ChatMessage) => {
		try {
			await navigator.clipboard.writeText(message.text);
			setCopyStatus({ id: message.id, text: "コピーしました" });
		} catch {
			setCopyStatus({
				id: message.id,
				text: "コピーできませんでした。本文を選択してコピーしてください。",
			});
		}
	};
	const entries = [
		...messages.map((message, index) => ({
			order: message.order ?? index,
			message,
			tool: undefined,
		})),
		...tools.map((tool, index) => ({
			order: tool.order ?? messages.length + index,
			message: undefined,
			tool,
		})),
	].sort((a, b) => a.order - b.order);
	return entries.map(({ message, tool }) => {
		if (tool) {
			return renderTool?.(tool);
		}
		if (!message) {
			return null;
		}
		const index = messages.indexOf(message);
		const user = message.role === "user";
		const previousUser = messages
			.slice(0, index)
			.reverse()
			.find((item) => item.role === "user");
		const nextUser = messages.findIndex(
			(item, position) => position > index && item.role === "user",
		);
		const endIndex = nextUser === -1 ? messages.length - 1 : nextUser - 1;
		const reply = messages[endIndex];
		const target = user
			? reply?.role === "assistant"
				? reply
				: undefined
			: previousUser;
		const replyPending = user && nextUser === -1 && busy;
		return (
			<article
				className={`message ${message.role} mb-[24px] min-w-0 rounded-[9px] border border-solid p-[14px] ${messageFocusClass} ${user ? "bg-message-user border-message-border" : "bg-message-assistant border-message-assistant-border"}`}
				key={message.id}
				tabIndex={-1}
				ref={(element) => {
					if (element) {
						elements.current.set(message.id, element);
					} else {
						elements.current.delete(message.id);
					}
				}}
			>
				<div className="message-text whitespace-pre-wrap leading-[1.85] [overflow-wrap:anywhere]">
					{user ? (
						<MessageText text={message.text} />
					) : (
						<TextType
							text={message.text}
							streaming={busy && index === messages.length - 1}
						/>
					)}
				</div>
				<div
					className={`message-actions mt-[10px] flex justify-end gap-[6px] ${messageFocusClass}`}
					tabIndex={-1}
					ref={(element) => {
						if (element) {
							elements.current.set(`${message.id}:end`, element);
						} else {
							elements.current.delete(`${message.id}:end`);
						}
					}}
				>
					{!user && (
						<button
							type="button"
							className={`${iconButtonClass} bg-[#416482]`}
							aria-label="回答をコピー"
							title="回答をコピー"
							onClick={() => void copy(message)}
						>
							<Copy size={16} aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						className={`${iconButtonClass} bg-[#416482]`}
						aria-label={
							user ? "回答の末尾へ移動" : "送信メッセージへ移動"
						}
						title={
							user ? "回答の末尾へ移動" : "送信メッセージへ移動"
						}
						disabled={!target || replyPending}
						onClick={() => {
							if (target) {
								jump(target.id, user);
							}
						}}
					>
						{user ? (
							<ArrowDownToLine size={16} aria-hidden="true" />
						) : (
							<ArrowUpToLine size={16} aria-hidden="true" />
						)}
					</button>
				</div>
				{copyStatus?.id === message.id && (
					<span
						role="status"
						className="muted text-[12px] text-muted"
					>
						{copyStatus.text}
					</span>
				)}
			</article>
		);
	});
}
