// 会話内検索の入力・一致条件・前後移動をコンパクトなバーにまとめる。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

import { cn } from "cnfast";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SettingsTooltip } from "../SettingsTooltip";
import "./chatSearch.css";
import { type FindOptions } from "./findMatches";
import type { useChatSearch } from "./useChatSearch";
import type { KeyboardEvent } from "react";

const buttonClass =
	"chat-search-button inline-grid h-6 w-[22px] shrink-0 place-items-center rounded-[3px] border border-solid border-transparent bg-transparent p-0 text-[12px]";

/** 会話内検索バーの配置・背景と下端の区切り線。 */
const searchBarStyle = cn(
	"chat-search shrink-0 border-0 border-b border-solid border-panel-border",
	"bg-menu px-2 py-1",
);

/** 会話内検索の表示状態、検索条件・結果と移動操作。 */
type ChatSearchBarProps = {
	search: ReturnType<typeof useChatSearch>;
};

/** ショートカットと読み上げ名を備えた、会話専用の検索バー。 */
export function ChatSearchBar({ search }: ChatSearchBarProps) {
	if (!search.open) {
		return null;
	}
	const { result, options } = search;
	const counter = `${isNonZeroNumber(result.count) ? result.index + 1 : 0}/${result.count}${result.limited ? "+" : ""}`;
	return (
		<div className={searchBarStyle}>
			<form
				role="search"
				aria-label="会話内検索"
				className="flex min-w-0 items-center gap-1"
				onSubmit={(event) => {
					event.preventDefault();
				}}
			>
				<ChatSearchInput
					search={search}
					result={result}
					options={options}
				/>
				<SearchPreviousButton result={result} search={search} />
				<SettingsTooltip content="次の一致 (Enter)">
					<button
						type="button"
						className={buttonClass}
						aria-label="次の一致"
						disabled={!isNonZeroNumber(result.count)}
						onClick={() => search.move(1)}
						onKeyDown={(event) => handleSearchKey(event, search)}
					>
						<ChevronRight size={14} />
					</button>
				</SettingsTooltip>
				<output
					aria-label="検索結果"
					aria-live="polite"
					className="shrink-0 text-[12px] whitespace-nowrap tabular-nums"
				>
					{counter}
				</output>
				<SettingsTooltip content="閉じる (Escape)">
					<button
						type="button"
						className={buttonClass}
						aria-label="検索を閉じる"
						onClick={search.close}
						onKeyDown={(event) => handleSearchKey(event, search)}
					>
						<X size={14} />
					</button>
				</SettingsTooltip>
			</form>
			{result.error !== "" && (
				<p role="alert" className="my-1 text-[12px] text-tool-error">
					{result.error}
				</p>
			)}
		</div>
	);
}

/** 検索語・一致条件と、検索結果や入力エラーの表示状態。 */
type ChatSearchInputProps = {
	search: ReturnType<typeof useChatSearch>;
	result: { count: number; index: number; limited: boolean; error: string };
	options: FindOptions;
};

/** 前の一致へ移動する操作と、移動可否を判定する検索結果。 */
type SearchPreviousButtonProps = {
	result: { count: number; index: number; limited: boolean; error: string };
	search: ReturnType<typeof useChatSearch>;
};

/** 検索条件を保持したまま前の一致へ移動する。 */
function SearchPreviousButton({ result, search }: SearchPreviousButtonProps) {
	return (
		<SettingsTooltip content="前の一致 (Shift+Enter)">
			<button
				type="button"
				className={buttonClass}
				aria-label="前の一致"
				disabled={!isNonZeroNumber(result.count)}
				onClick={() => search.move(-1)}
				onKeyDown={(event) => handleSearchKey(event, search)}
			>
				<ChevronLeft size={14} />
			</button>
		</SettingsTooltip>
	);
}

/** 検索語と一致条件を同じ入力領域で編集する。 */
function ChatSearchInput({ search, result, options }: ChatSearchInputProps) {
	const { setInput, query, setQuery, setOptions } = search;
	return (
		<div
			className={cn(
				"flex min-w-0 flex-1 items-center rounded border border-solid",
				"border-input-border bg-input",
				"focus-within:border-focus",
			)}
		>
			<input
				ref={(element) => setInput(element)}
				aria-label="会話を検索"
				aria-invalid={!(result.error === "")}
				title="会話を検索 (Ctrl+F)"
				className={cn(
					"w-full min-w-0 border-0 bg-transparent px-2 py-1 text-[12px]",
					"text-input-text outline-none",
				)}
				placeholder="検索"
				autoComplete="off"
				spellCheck={false}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => handleSearchKey(event, search)}
			/>
			{(
				[
					["caseSensitive", "大文字と小文字を区別", "Aa"],
					["wholeWord", "単語単位", "ab"],
					["regex", "正規表現", ".*"],
				] as const
			).map(([key, label, icon]) => (
				<SettingsTooltip content={label} key={key}>
					<button
						type="button"
						className={cn(
							buttonClass,
							key === "wholeWord"
								? "underline underline-offset-2"
								: "",
						)}
						aria-label={label}
						aria-pressed={options[key]}
						onKeyDown={(event) => handleSearchKey(event, search)}
						onClick={() =>
							setOptions({
								...options,
								[key]: !options[key],
							})
						}
					>
						{icon}
					</button>
				</SettingsTooltip>
			))}
		</div>
	);
}

/** Escape は各操作から検索を閉じ、入力欄の Enter だけ一致位置の移動に使う。 */
function handleSearchKey(
	event: KeyboardEvent<HTMLElement>,
	search: ReturnType<typeof useChatSearch>,
) {
	if (event.nativeEvent.isComposing) {
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		search.close();
	}
	if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
		event.preventDefault();
		search.move(event.shiftKey ? -1 : 1);
	}
}
