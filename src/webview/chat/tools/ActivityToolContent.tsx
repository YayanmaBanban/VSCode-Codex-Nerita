// 推論のMarkdownと、画像・Web検索の参照先を専用本文として表示する。
import type { ToolSummary } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import { isRecord } from "../../../shared/validation";
import { MessageText } from "../messages/MessageText";
import { GuardianReview } from "./GuardianReview";

export type ActivityToolProps = {
	tool: ToolSummary;
	send?: ((message: UiMessage) => void) | undefined;
	cwd?: string | null | undefined;
};
const linkClass =
	"text-[var(--vscode-textLink-foreground,#6dadc9)] underline underline-offset-2 [overflow-wrap:anywhere]";

export function ThinkTool({ tool }: ActivityToolProps) {
	// 旧形式の審査カードはタイトルが任意なので、構造化審査の有無も尊重する。
	if (
		[tool.rawInput, tool.rawOutput].some(
			(value) => isRecord(value) && isRecord(value.review),
		)
	) {
		return <GuardianReview tool={tool} />;
	}
	return (
		<>
			{tool.content?.map((value, index) => {
				const content =
					isRecord(value) && isRecord(value.content)
						? value.content
						: value;
				const text =
					typeof content === "string"
						? content
						: isRecord(content) && typeof content.text === "string"
							? content.text
							: "";
				return text ? <MessageText key={index} text={text} /> : null;
			})}
		</>
	);
}

/** パスの予約文字をURIへエスケープし、相対パスは実行時のcwdで解決する。 */
function fileUri(path: string, cwd?: string | null): string | undefined {
	let normalized = path.replaceAll("\\", "/");
	if (!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) {
		if (!cwd) {
			return undefined;
		}
		normalized = `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized}`;
	}
	return `file:${normalized.startsWith("//") ? "" : normalized.startsWith("/") ? "//" : "///"}${normalized
		.split("/")
		.map(encodeURIComponent)
		.join("/")
		.replace(/^([a-z])%3A/i, "$1:")}`;
}

export function ImageViewTool({ tool, send, cwd }: ActivityToolProps) {
	return (
		<>
			{tool.paths.map((path, index) => {
				const uri = fileUri(path, tool.cwd ?? cwd);
				return (
					<div key={index}>
						{uri && send ? (
							<a
								className={linkClass}
								href={uri}
								onClick={(event) => {
									event.preventDefault();
									send({
										type: "reference/open",
										requestId: crypto.randomUUID(),
										uri,
									});
								}}
							>
								{path}
							</a>
						) : (
							<span className="[overflow-wrap:anywhere]">
								{path}
							</span>
						)}
					</div>
				);
			})}
		</>
	);
}

export function WebSearchTool({ tool }: ActivityToolProps) {
	const input = isRecord(tool.rawInput) ? tool.rawInput : {};
	const action = isRecord(input.action) ? input.action : input;
	const query =
		typeof tool.rawInput === "string" ? tool.rawInput : input.query;
	const label =
		typeof query === "string" && query.trim()
			? query
			: typeof action.url === "string"
				? action.url
				: "";
	if (!label) {
		return null;
	}
	// 検索語は検索リンクへ、URLはHTTP(S)だけを直接開く。
	const href = /^https?:\/\//i.test(label)
		? label
		: `https://www.google.com/search?q=${encodeURIComponent(label)}`;
	return (
		<a
			className={linkClass}
			href={href}
			target="_blank"
			rel="noreferrer noopener"
		>
			{label}
		</a>
	);
}
