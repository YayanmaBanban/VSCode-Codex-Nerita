// 検索ペインと候補ペインを持ち、選択中の行を見える範囲に保つ。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { cn } from "cnfast";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import type { CompletionItem } from "./completionItems";
import { CompletionOption } from "./CompletionOption";
import { useInitialFocus } from "../../hooks/useInitialFocus";

/** 補完候補・検索語・選択位置と、検索や候補選択の操作。 */
type CompletionMenuProps = {
	id: string;
	title: string;
	query: string;
	items: CompletionItem[];
	selected: number;
	empty: string;
	onQuery: (text: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	onPick: (item: CompletionItem) => void;
	location?: string | undefined;
	notice?: string | undefined;
	header?: ReactNode;
	context?: boolean;
	autoFocus?: boolean;
};

/** 検索中も本文の選択範囲を保持し、キーボードとクリックを共通化する。 */
export function CompletionMenu(props: CompletionMenuProps) {
	const { title, items, selected, location, notice, header, context } = props;
	const list = useRef<HTMLDivElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const [above, setAbove] = useState(true);
	// 拡張した入力欄の上に余白がない場合は、入力欄に重ねて画面内へ収める。
	useLayoutEffect(() => {
		const element = panel.current;
		const update = () => {
			if (element) {
				setAbove(
					(element.parentElement?.getBoundingClientRect().top ?? 0) >=
						element.offsetHeight + 12,
				);
			}
		};
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, [items.length, title]);
	useEffect(() => {
		list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
	}, [selected]);
	return (
		<div
			ref={panel}
			className={cn(
				"absolute left-0 z-50 flex max-h-[min(560px,80dvh)] min-w-0 flex-col",
				"overflow-y-auto rounded-[6px] border border-panel-border bg-input p-2",
				"shadow-lg",
				context === true ? "w-[min(460px,calc(100vw-54px))]" : "w-full",
				above ? "bottom-full mb-2" : "top-0",
			)}
			role="region"
			aria-label={title}
		>
			{header}
			<CompletionSearchInput {...props} />
			{isNonEmptyString(location) && (
				<p className="mb-2 text-[12px] break-all text-muted">
					{location}
				</p>
			)}
			{isNonEmptyString(notice) && (
				<p role="status" className="mb-2 text-[12px] text-muted">
					{notice}
				</p>
			)}
			<CompletionList list={list} {...props} />
		</div>
	);
}

/** 補完の検索語、選択中の候補と検索欄のキー操作。 */
type CompletionSearchInputProps = {
	context?: undefined | false | true;
	autoFocus?: undefined | false | true;
	title: string;
	id: string;
	items: CompletionItem[];
	selected: number;
	query: string;
	onQuery: (text: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	location?: undefined | string;
};

/** 補完候補と選択位置、空の一覧に表示する文言と候補を選ぶ操作。 */
type CompletionListProps = {
	list: RefObject<HTMLDivElement | null>;
	id: string;
	title: string;
	items: CompletionItem[];
	selected: number;
	context?: boolean | undefined;
	onPick: (item: CompletionItem) => void;
	empty: string;
};

/** 候補一覧の選択状態と空の表示を揃える。 */
function CompletionList({
	list,
	id,
	title,
	items,
	selected,
	context,
	onPick,
	empty,
}: CompletionListProps) {
	return (
		<div
			ref={list}
			id={id}
			role="listbox"
			aria-label={title}
			className="max-h-[min(240px,35vh)] overflow-y-auto"
		>
			{items.map((item, index) => (
				<CompletionOption
					key={item.id}
					id={`${id}-${index}`}
					item={item}
					selected={index === selected}
					context={Boolean(context)}
					onPick={onPick}
				/>
			))}
			{items.length === 0 && (
				<p className="p-2 text-[12px] text-muted" role="status">
					{empty}
				</p>
			)}
		</div>
	);
}

/** 本文の選択を保持したまま補完候補を検索する。 */
function CompletionSearchInput({
	context,
	autoFocus,
	title,
	id,
	items,
	selected,
	query,
	onQuery,
	onKeyDown,
	location,
}: CompletionSearchInputProps) {
	const input = useInitialFocus<HTMLInputElement>(autoFocus === true);
	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-2",
				context === true
					? "order-last mt-2 border-t border-panel-border pt-2"
					: "mb-2 border-b border-panel-border pb-2",
			)}
		>
			<input
				ref={input}
				aria-label={`${title}を検索`}
				role="combobox"
				aria-expanded="true"
				aria-controls={id}
				aria-activedescendant={
					items[selected] ? `${id}-${selected}` : undefined
				}
				value={query}
				onChange={(event) => onQuery(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder={
					isNonEmptyString(location)
						? "この階層を検索"
						: `${title}を検索`
				}
				className={cn(
					"w-full min-w-0 rounded border border-input-border bg-input p-2",
					"text-input-text",
					"focus:outline-2 focus:outline-focus",
				)}
			/>
		</div>
	);
}
