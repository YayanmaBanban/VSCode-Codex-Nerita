// 会話内検索の入力・一致条件・前後移動をコンパクトなバーにまとめる。
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { useChatSearch } from "./useChatSearch";
import "./chatSearch.css";

const buttonClass =
	"chat-search-button inline-grid h-6 w-[22px] shrink-0 place-items-center rounded-[3px] border border-solid border-transparent bg-transparent p-0 text-[12px]";

/** ショートカットと読み上げ名を備えた、会話専用の検索バー。 */
export function ChatSearchBar({
	search,
}: {
	search: ReturnType<typeof useChatSearch>;
}) {
	if (!search.open) {
		return null;
	}
	const { result, options } = search;
	const counter = `${result.count ? result.index + 1 : 0}/${result.count}${result.limited ? "+" : ""}`;
	return (
		<div className="chat-search shrink-0 border-0 border-b border-solid border-panel-border bg-menu px-2 py-1">
			<form
				role="search"
				aria-label="会話内検索"
				className="flex min-w-0 items-center gap-1"
				onSubmit={(event) => {
					event.preventDefault();
				}}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) {
						return;
					}
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						search.close();
					}
					if (
						event.key === "Enter" &&
						event.target === search.input.current
					) {
						event.preventDefault();
						search.move(event.shiftKey ? -1 : 1);
					}
				}}
			>
				<div className="flex min-w-0 flex-1 items-center rounded border border-solid border-input-border bg-input focus-within:border-focus">
					<input
						ref={search.input}
						aria-label="会話を検索"
						aria-invalid={!!result.error}
						title="会話を検索 (Ctrl+F)"
						className="min-w-0 w-full border-0 bg-transparent px-2 py-1 text-[12px] text-input-text outline-none"
						placeholder="検索"
						autoComplete="off"
						spellCheck={false}
						value={search.query}
						onChange={(event) =>
							search.setQuery(event.target.value)
						}
					/>
					{(
						[
							["caseSensitive", "大文字と小文字を区別", "Aa"],
							["wholeWord", "単語単位", "ab"],
							["regex", "正規表現", ".*"],
						] as const
					).map(([key, label, icon]) => (
						<button
							key={key}
							type="button"
							className={`${buttonClass} ${key === "wholeWord" ? "underline underline-offset-2" : ""}`}
							aria-label={label}
							title={label}
							aria-pressed={options[key]}
							onClick={() =>
								search.setOptions({
									...options,
									[key]: !options[key],
								})
							}
						>
							{icon}
						</button>
					))}
				</div>
				<button
					type="button"
					className={buttonClass}
					aria-label="前の一致"
					title="前の一致 (Shift+Enter)"
					disabled={!result.count}
					onClick={() => search.move(-1)}
				>
					<ChevronLeft size={14} />
				</button>
				<button
					type="button"
					className={buttonClass}
					aria-label="次の一致"
					title="次の一致 (Enter)"
					disabled={!result.count}
					onClick={() => search.move(1)}
				>
					<ChevronRight size={14} />
				</button>
				<output
					aria-label="検索結果"
					aria-live="polite"
					className="shrink-0 whitespace-nowrap text-[12px] tabular-nums"
				>
					{counter}
				</output>
				<button
					type="button"
					className={buttonClass}
					aria-label="検索を閉じる"
					title="閉じる (Escape)"
					onClick={search.close}
				>
					<X size={14} />
				</button>
			</form>
			{result.error && (
				<p role="alert" className="my-1 text-[12px] text-tool-error">
					{result.error}
				</p>
			)}
		</div>
	);
}
