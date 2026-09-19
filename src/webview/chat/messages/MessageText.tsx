// 通常メッセージのMarkdownをReact要素へ変換し、テーマに沿って表示する。
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/** Webview内の横幅とリンク操作に合わせた要素の表示を定義する。 */
const components: Components = {
	a: ({ href, children, title }) => (
		<a
			href={href}
			title={title}
			target="_blank"
			rel="noreferrer noopener"
			className="text-[var(--vscode-textLink-foreground,#6dadc9)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
		>
			{children}
		</a>
	),
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

/** 生のHTMLは実行せず、表・リスト・改行を含むMarkdownを表示する。 */
export function MessageText({ text }: { text: string }) {
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
				components={components}
			>
				{text}
			</Markdown>
		</div>
	);
}
