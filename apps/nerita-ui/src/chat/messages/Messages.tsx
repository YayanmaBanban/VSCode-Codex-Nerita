// メッセージと、同じターンへの移動・回答コピーを表示する。

import { type ReactNode, type RefObject, useRef, useState } from "react";

import { SettingsTooltip } from "../SettingsTooltip";
import { cn } from "cnfast";

import { ArrowDownToLine, ArrowUpToLine, Copy } from "lucide-react";
import type { UiMessage } from "@nerita/shared/messages";
import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
import { MessageText } from "./MessageText";
import { McpMessage } from "./McpMessage";
import { messageIconButtonClass, messageFocusClass } from "./messageStyles";
import type { SubAgentSummary } from "@nerita/shared/subAgents";

/** 表示するメッセージ、ユーザー発言かどうかの指定と操作要求の送信関数。 */
type MessageContentProps = {
	message: ChatMessage;
	user: boolean;
	send?: ((message: UiMessage) => void) | undefined;
};

/** メッセージのテキストを表示するコンポーネント。 */
function MessageContent({
	message,
	user,
	send,
}: MessageContentProps): React.JSX.Element {
	if (message.mcp) {
		return <McpMessage content={message.mcp} text={message.text} />;
	}
	return (
		<MessageText
			text={message.text}
			send={send}
			references={user ? message.references : undefined}
		/>
	);
}

/** メッセージ・ツール・子スレッドの一覧と、それぞれの描画・操作。 */
type MessagesProps = {
	messages: ChatMessage[];
	busy: boolean;
	send?: ((message: UiMessage) => void) | undefined;
	tools?: ToolSummary[];
	renderTool?: (tool: ToolSummary) => ReactNode;
	agents?: SubAgentSummary[];
	renderAgent?: (agent: SubAgentSummary) => ReactNode;
};

/** DOM の参照で移動先を解決し、別のチャット画面への干渉を防ぐ。 */
export function Messages({
	messages,
	busy,
	send,
	tools = [],
	renderTool,
	agents = [],
	renderAgent,
}: MessagesProps) {
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
	const entries = messageTimeline(messages, tools, agents);
	return entries.map(({ message, tool, agent }) => {
		if (agent) {
			return renderAgent?.(agent);
		}
		if (tool) {
			return renderTimelineTool(tool, tools, renderTool);
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
		const target = turnNavigationTarget(user, reply, previousUser);
		const replyPending = isReplyPending(user, nextUser, busy);
		return (
			<MessageEntry
				key={message.id}
				message={message}
				user={user}
				elements={elements}
				send={send}
				copy={copy}
				target={target}
				replyPending={replyPending}
				jump={jump}
				copyStatus={copyStatus}
			/>
		);
	});
}

/** メッセージの表示状態と、ターン移動・コピーの操作や結果。 */
type MessageEntryProps = {
	message: ChatMessage;
	user: boolean;
	elements: RefObject<Map<string, HTMLElement>>;
	send: ((message: UiMessage) => void) | undefined;
	copy: (message: ChatMessage) => Promise<void>;
	target: undefined | ChatMessage;
	replyPending: boolean;
	jump: (id: string, end: boolean) => void;
	copyStatus: null | { id: string; text: string };
};

/** 発言・ツール・子の結果を共通の順序で並べる。 */
function messageTimeline(
	messages: ChatMessage[],
	tools: ToolSummary[],
	agents: SubAgentSummary[],
) {
	return [
		...messages.map((message, index) => ({
			order: message.order ?? index,
			message,
			tool: undefined,
			agent: undefined,
		})),
		...tools.map((tool, index) => ({
			order: tool.order ?? messages.length + index,
			message: undefined,
			tool,
			agent: undefined,
		})),
		...agents.map((agent) => ({
			order: agent.order,
			agent,
			message: undefined,
			tool: undefined,
		})),
	].sort((a, b) => a.order - b.order);
}

/** 本文・ターン移動・コピー結果を同じメッセージに表示する。 */
function MessageEntry(props: MessageEntryProps) {
	const {
		message,
		user,
		elements,
		copy,
		target,
		replyPending,
		jump,
		copyStatus,
	} = props;
	return (
		<article
			className={cn(
				"message",
				message.role,
				"mb-[24px] min-w-0 p-[14px]",
				"rounded-[9px] border border-solid",
				messageFocusClass,
				user
					? "border-message-border bg-message-user"
					: "border-transparent bg-transparent",
			)}
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
			<div className="message-text leading-[1.85] [overflow-wrap:anywhere]">
				<MessageContent {...props} />
			</div>
			{renderMessageActions(
				elements,
				message,
				user,
				copy,
				target,
				replyPending,
				jump,
			)}
			{copyStatus?.id === message.id && (
				<span role="status" className="muted text-[12px] text-muted">
					{copyStatus.text}
				</span>
			)}
		</article>
	);
}

/** 子カードに親の名前を添え、実行中と復元した履歴を同じ配置で表示する。 */
function renderTimelineTool(
	tool: ToolSummary,
	tools: ToolSummary[],
	renderTool: ((tool: ToolSummary) => ReactNode) | undefined,
) {
	if (!tool.parentToolCallId) {
		return renderTool?.(tool);
	}
	const parent = tools.find(
		(item) =>
			item.id === tool.parentToolCallId && item.runId === tool.runId,
	);
	return (
		<div
			key={`${tool.runId}:${tool.id}`}
			className={cn(
				"nested-tool my-[8px] border-0 border-l border-solid border-panel-border",
				"pl-[12px]",
			)}
		>
			<div className="text-[12px] [overflow-wrap:anywhere] text-muted">
				{parent ? `親ツール: ${parent.title}` : "入れ子のツール"}
			</div>
			{renderTool?.(tool)}
		</div>
	);
}

/** 最後のユーザー発言への回答待ちを判定する。 */
function isReplyPending(user: boolean, nextUser: number, busy: boolean) {
	return user && nextUser === -1 && busy;
}

/** コピーと同じターンへの移動ボタンを表示する。 */
function renderMessageActions(
	elements: RefObject<Map<string, HTMLElement>>,
	message: ChatMessage,
	user: boolean,
	copy: (message: ChatMessage) => Promise<void>,
	target: ChatMessage | undefined,
	replyPending: boolean,
	jump: (id: string, end: boolean) => void,
) {
	return (
		<div
			className={cn(
				"message-actions mt-[10px] flex justify-end gap-[6px]",
				messageFocusClass,
			)}
			tabIndex={-1}
			ref={(element) => {
				if (element) {
					elements.current.set(`${message.id}:end`, element);
				} else {
					elements.current.delete(`${message.id}:end`);
				}
			}}
		>
			<div
				className={cn(
					"ml-auto flex items-center gap-2",
					"rounded-lg",
					"border border-menu-border",
					"bg-message-user",
					"p-0.5",
				)}
			>
				{!user && message.mcp?.status !== "loading" && (
					<CopyAnswerButton copy={copy} message={message} />
				)}
				<SettingsTooltip
					content={user ? "回答の末尾へ移動" : "送信メッセージへ移動"}
				>
					<button
						type="button"
						className={cn(
							messageIconButtonClass,
							"rounded-md",
							"size-7",
							"bg-transparent",
							"hover:bg-settings-hover",
						)}
						aria-label={
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
				</SettingsTooltip>
			</div>
		</div>
	);
}

/** コピーする回答と、コピー処理を実行する関数。 */
type CopyAnswerButtonProps = {
	copy: (message: ChatMessage) => Promise<void>;
	message: ChatMessage;
};

/** 回答のコピー操作を支援技術向けの文言とともに表示する。 */
function CopyAnswerButton({ copy, message }: CopyAnswerButtonProps): ReactNode {
	return (
		<SettingsTooltip content="回答をコピー">
			<button
				type="button"
				className={cn(
					messageIconButtonClass,
					"rounded-md",
					"size-7",
					"bg-transparent",
					"hover:bg-settings-hover",
				)}
				aria-label="回答をコピー"
				onClick={() => void copy(message)}
			>
				<Copy size={16} aria-hidden="true" />
			</button>
		</SettingsTooltip>
	);
}

/** ユーザー発言から回答へ、回答から直前のユーザー発言へ移動する。 */
function turnNavigationTarget(
	user: boolean,
	reply: ChatMessage | undefined,
	previousUser: ChatMessage | undefined,
) {
	if (user) {
		if (reply?.role === "assistant") {
			return reply;
		}
		return undefined;
	}
	return previousUser;
}
