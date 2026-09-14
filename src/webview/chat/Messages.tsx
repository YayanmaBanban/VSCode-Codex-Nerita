// メッセージと、同じターンへの移動・回答コピーを表示する。
import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Copy } from "lucide-react";
import type { ChatMessage } from "../../shared/messages";
import { MessageText } from "./MessageText";
import { TextType } from "./TextType";
import "./messages.css";

/** DOM の参照で移動先を解決し、別のチャット画面への干渉を防ぐ。 */
export function Messages({
	messages,
	busy,
}: {
	messages: ChatMessage[];
	busy: boolean;
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
	return messages.map((message, index) => {
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
				className={`message ${message.role}`}
				key={message.id}
				tabIndex={-1}
				ref={(element) => {
					if (element) elements.current.set(message.id, element);
					else elements.current.delete(message.id);
				}}
			>
				<div className="message-text">
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
					className="message-actions"
					tabIndex={-1}
					ref={(element) => {
						if (element)
							elements.current.set(`${message.id}:end`, element);
						else elements.current.delete(`${message.id}:end`);
					}}
				>
					{!user && (
						<button
							type="button"
							className="icon-button"
							aria-label="回答をコピー"
							title="回答をコピー"
							onClick={() => void copy(message)}
						>
							<Copy size={16} aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						className="icon-button"
						aria-label={
							user ? "回答の末尾へ移動" : "送信メッセージへ移動"
						}
						title={
							user ? "回答の末尾へ移動" : "送信メッセージへ移動"
						}
						disabled={!target || replyPending}
						onClick={() => {
							if (target) jump(target.id, user);
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
					<span role="status" className="muted">
						{copyStatus.text}
					</span>
				)}
			</article>
		);
	});
}
