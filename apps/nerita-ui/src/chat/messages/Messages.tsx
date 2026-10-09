// メッセージと、同じターンへの移動・回答コピーを表示する。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import { type ReactNode, type RefObject, useMemo, useRef } from "react";
import {
	messageTimeline,
	type MessageTimeline,
	type TimelineEntry,
} from "./messageTimeline";
import type { ConversationVirtualizer } from "./useConversationVirtualizer";

import { SettingsTooltip } from "../SettingsTooltip";
import { cn } from "cnfast";
import { ArrowUpToLine } from "lucide-react";
import type { UiMessage } from "@nerita/shared/messages";
import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
import { MessageText } from "./MessageText";
import { McpMessage } from "./McpMessage";
import { messageIconButtonClass, messageFocusClass } from "./messageStyles";
import type { SubAgentSummary } from "@nerita/shared/subAgents";
import { CopyButton } from "../CopyButton";
import { MessageReferenceChip } from "./MessageReferenceChip";
import { useStreamingText } from "./useStreamingText";

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
	const text = useStreamingText(
		message.text,
		!user && !message.mcp && message.streaming === true,
	);
	if (message.mcp) {
		return <McpMessage content={message.mcp} text={message.text} />;
	}
	return (
		<MessageText
			text={text}
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
	timeline?: MessageTimeline;
	virtual?: ConversationVirtualizer;
};

/** DOM の参照で移動先を解決し、別のチャット画面への干渉を防ぐ。 */
export function Messages({
	messages,
	send,
	tools = [],
	renderTool,
	agents = [],
	renderAgent,
	timeline,
	virtual,
}: MessagesProps) {
	const elements = useRef(new Map<string, HTMLElement>());
	/** 回答から対応する送信メッセージの先頭へ移動する。 */
	const jump = (id: string) => {
		if (virtual) {
			virtual.reveal(`message:${id}`, true);
			return;
		}
		const element = elements.current.get(id);
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({
			block: "start",
			behavior: "instant",
		});
	};
	const data = useMemo(
		() => timeline ?? messageTimeline(messages, tools, agents),
		[timeline, messages, tools, agents],
	);
	const render = (entry: TimelineEntry) => {
		if (entry.kind === "agent") {
			return renderAgent?.(entry.agent);
		}
		if (entry.kind === "tool") {
			return renderTimelineTool(entry.tool, entry.parent, renderTool);
		}
		return (
			<MessageEntry
				key={entry.key}
				message={entry.message}
				user={entry.message.role === "user"}
				elements={elements}
				send={send}
				target={entry.previousUser}
				jump={jump}
			/>
		);
	};
	if (!virtual) {
		return data.entries.map((entry) => (
			<div
				key={entry.key}
				data-entry-key={entry.key}
				className="flow-root"
			>
				{render(entry)}
			</div>
		));
	}
	return <VirtualMessages virtual={virtual} data={data} render={render} />;
}

/** 測定対象の行には余白を含め、描画範囲に入った行だけをマウントする。 */
function VirtualMessages({
	virtual,
	data,
	render,
}: {
	virtual: ConversationVirtualizer;
	data: MessageTimeline;
	render: (entry: TimelineEntry) => ReactNode;
}) {
	const { virtualizer, list } = virtual;
	return (
		<div
			ref={list}
			className="relative w-full"
			data-entry-count={data.entries.length}
			style={{ height: virtualizer.getTotalSize() }}
		>
			{virtualizer.getVirtualItems().map((item) => (
				<div
					key={item.key}
					ref={virtualizer.measureElement}
					data-index={item.index}
					data-entry-key={data.entries[item.index]!.key}
					className="absolute top-0 left-0 flow-root w-full"
					style={{
						transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
					}}
				>
					{render(data.entries[item.index]!)}
				</div>
			))}
		</div>
	);
}

/** メッセージの表示状態と、同じターンの送信文への移動操作。 */
type MessageEntryProps = {
	message: ChatMessage;
	user: boolean;
	elements: RefObject<Map<string, HTMLElement>>;
	send: ((message: UiMessage) => void) | undefined;
	target: undefined | ChatMessage;
	jump: (id: string) => void;
};

/** 本文・添付・ターン移動と回答コピーの操作を表示する。 */
function MessageEntry(props: MessageEntryProps) {
	const { message, user, elements, target, jump } = props;
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
			{user && isNonZeroNumber(message.attachments?.length) && (
				<div
					className="mt-2 flex flex-wrap gap-1.5"
					aria-label="添付ファイル"
				>
					{message.attachments.map((file) => (
						<MessageReferenceChip
							key={file.id}
							path={{
								kind: "file",
								name: file.name,
								path: file.uri,
								uri: file.uri,
							}}
							send={props.send}
						/>
					))}
				</div>
			)}
			{!user && renderMessageActions(message, target, jump)}
		</article>
	);
}

/** 子カードに親の名前を添え、実行中と復元した履歴を同じ配置で表示する。 */
function renderTimelineTool(
	tool: ToolSummary,
	parent: ToolSummary | undefined,
	renderTool: ((tool: ToolSummary) => ReactNode) | undefined,
) {
	if (!isNonEmptyString(tool.parentToolCallId)) {
		return renderTool?.(tool);
	}
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

/** コピーと同じターンへの移動ボタンを表示する。 */
function renderMessageActions(
	message: ChatMessage,
	target: ChatMessage | undefined,
	jump: (id: string) => void,
) {
	return (
		<div
			className={cn(
				"message-actions mt-[10px] flex justify-end gap-[6px]",
				messageFocusClass,
			)}
			tabIndex={-1}
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
				{message.mcp?.status !== "loading" && (
					<CopyButton
						text={message.text}
						label="回答をコピー"
						className="size-7 rounded-md"
						iconSize={16}
					/>
				)}
				<SettingsTooltip content="送信メッセージへ移動">
					<button
						type="button"
						className={cn(
							messageIconButtonClass,
							"rounded-md",
							"size-7",
							"bg-transparent",
							"hover:bg-settings-hover",
						)}
						aria-label="送信メッセージへ移動"
						disabled={!target}
						onClick={() => {
							if (target) {
								jump(target.id);
							}
						}}
					>
						<ArrowUpToLine size={16} aria-hidden="true" />
					</button>
				</SettingsTooltip>
			</div>
		</div>
	);
}
