// 通常メッセージの Markdown を React 要素へ変換し、テーマに沿って表示する。
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import type { UiMessage } from "../../../shared/messages";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { ComposerReference } from "../../../shared/composerReferences";
import { messageReferences } from "./messageReferences";
import { MessageReferenceChip } from "./MessageReferenceChip";

/** 絶対パスだけを `file` URI へ変換し、その他の URL には既定の安全性検証を適用する。 */
function markdownUrl(url: string): string {
	if (/^[a-z]:[\\/]/i.test(url)) {
		return `file:///${url.replaceAll("\\", "/")}`;
	}
	if (/^\/(?!\/)/.test(url)) {
		return `file://${url}`;
	}
	if (/^file:\/\//i.test(url)) {
		return url;
	}
	return defaultUrlTransform(url);
}

/** Webview 内の横幅に合わせた要素の表示を定義する。 */
const components: Components = {
	pre: ({ children }) => (
		<pre className="my-[12px] overflow-x-auto rounded-[6px] bg-message-code p-[12px] text-[12px] whitespace-pre">
			{children}
		</pre>
	),
	table: ({ children }) => (
		<div className="my-[12px] max-w-full overflow-x-auto">
			<table className="w-full border-collapse text-left text-[12px]">
				{children}
			</table>
		</div>
	),
	// 本文中の画像は外部取得せず、代替テキストを表示する。
	img: ({ alt }) => <span>{alt || "画像"}</span>,
};

/** 生の HTML は実行せず、表・リスト・改行を含む Markdown を表示する。 */
export function MessageText({
	text,
	send,
	references = [],
}: {
	text: string;
	references?: ComposerReference[] | undefined;
	send?: ((message: UiMessage) => void) | undefined;
}) {
	const content = messageReferences(text, references);
	return (
		<div
			className={[
				"message-markdown min-w-0 whitespace-normal [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0",
				"[&_p]:my-[10px] [&_h1]:my-[16px] [&_h1]:text-[20px] [&_h2]:my-[14px] [&_h2]:text-[17px] [&_h3]:my-[12px] [&_h3]:text-[15px]",
				"[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
				"[&_ul]:my-[8px] [&_ul]:list-disc [&_ul]:pl-[22px] [&_ol]:my-[8px] [&_ol]:list-decimal [&_ol]:pl-[22px] [&_li]:my-[4px] [&_li>p]:my-[4px]",
				"[&_blockquote]:my-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-panel-border [&_blockquote]:pl-[12px] [&_blockquote]:text-muted",
				"[&_code]:rounded-[3px] [&_code]:bg-message-code [&_code]:px-[3px] [&_code]:font-mono [&_code]:text-[12px] [&_pre_code]:p-0",
				"[&_th]:border [&_th]:border-panel-border [&_th]:px-[8px] [&_th]:py-[5px] [&_td]:border [&_td]:border-panel-border [&_td]:px-[8px] [&_td]:py-[5px]",
				"[&_hr]:my-[16px] [&_hr]:border-panel-border [&_.task-list-item]:list-none [&_input]:mr-[6px]",
			].join(" ")}
		>
			<Markdown
				remarkPlugins={[remarkGfm, remarkBreaks]}
				rehypePlugins={content.targets.size ? [content.plugin] : []}
				urlTransform={markdownUrl}
				components={{
					...components,
					span: ({ children, title }) => {
						const reference = content.targets.get(title ?? "");
						if (reference) {
							return (
								<MessageReferenceChip
									path={reference}
									send={send}
								/>
							);
						}
						return <span title={title}>{children}</span>;
					},
					a: ({ href, children, title }) => {
						const local = /^file:\/\//i.test(href ?? "");
						return (
							<a
								href={href || undefined}
								title={title}
								target={local ? undefined : "_blank"}
								rel="noreferrer noopener"
								className="text-[var(--vscode-textLink-foreground,#6dadc9)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
								onClick={(event) => {
									if (local && href) {
										event.preventDefault();
										send?.({
											type: "reference/open",
											requestId: crypto.randomUUID(),
											uri: href,
										});
									}
								}}
							>
								{children}
							</a>
						);
					},
				}}
			>
				{content.text}
			</Markdown>
		</div>
	);
}
