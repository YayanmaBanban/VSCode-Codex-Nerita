// 推論の Markdown と、画像・Web 検索の参照先を専用本文として表示する。
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
	// 旧形式の審査カードはタイトルが一定でないため、入力・出力の review オブジェクトでも判定する。
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
				const text = contentText(content);
				return text ? <MessageText key={index} text={text} /> : null;
			})}
		</>
	);
}

/** パスの予約文字を URI へエスケープし、相対パスは実行時の `cwd` で解決する。 */
function fileUri(path: string, cwd?: string | null): string | undefined {
	let normalized = path.replaceAll("\\", "/");
	if (!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) {
		if (!cwd) {
			return undefined;
		}
		normalized = `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized}`;
	}
	return `file:${fileUriSlashes(normalized)}${normalized
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
	const label = searchLabel(query, action.url);
	if (!label) {
		return null;
	}
	// 検索語は検索リンクへ、URL は HTTP(S)だけを直接開く。
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

/** 文字列と構造化されたテキストから表示本文だけを取り出す。 */
function contentText(content: unknown) {
	if (typeof content === "string") {
		return content;
	}
	if (isRecord(content) && typeof content.text === "string") {
		return content.text;
	}
	return "";
}

/** UNC・絶対パス・ドライブパスに対応する URI の区切りを返す。 */
function fileUriSlashes(normalized: string) {
	if (normalized.startsWith("//")) {
		return "";
	}
	if (normalized.startsWith("/")) {
		return "//";
	}
	return "///";
}

/** 空でない検索語を優先し、なければ検索先 URL を表示する。 */
function searchLabel(query: unknown, url: unknown) {
	if (typeof query === "string" && query.trim()) {
		return query;
	}
	if (typeof url === "string") {
		return url;
	}
	return "";
}
