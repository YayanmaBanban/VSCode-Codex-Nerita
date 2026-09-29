// 検索ペインと候補ペインを持ち、選択中の行を見える範囲に保つ。
import { cn } from "cnfast";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import type { CompletionItem } from "./completionItems";
import { CompletionOption } from "./CompletionOption";

/** 検索中も本文の選択範囲を保持し、キーボードとクリックを共通化する。 */
export function CompletionMenu({
	id,
	title,
	query,
	items,
	selected,
	empty,
	onQuery,
	onKeyDown,
	onPick,
	location,
	notice,
	header,
	context,
	autoFocus,
}: {
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
}) {
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
				"absolute left-0 z-50 flex min-w-0 max-h-[min(560px,80dvh)] flex-col overflow-y-auto rounded-[6px] border border-panel-border bg-input p-2 shadow-lg",
				context ? "w-[min(460px,calc(100vw-54px))]" : "w-full",
				above ? "bottom-full mb-2" : "top-0",
			)}
			role="region"
			aria-label={title}
		>
			{header}
			<div
				className={cn(
					"flex shrink-0 items-center gap-2",
					context
						? "order-last mt-2 border-t border-panel-border pt-2"
						: "mb-2 border-b border-panel-border pb-2",
				)}
			>
				<input
					autoFocus={autoFocus}
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
					placeholder={location ? "この階層を検索" : `${title}を検索`}
					className="min-w-0 w-full rounded border border-input-border bg-input p-2 text-input-text focus:outline-2 focus:outline-focus"
				/>
			</div>
			{location && (
				<p className="mb-2 break-all text-[12px] text-muted">
					{location}
				</p>
			)}
			{notice && (
				<p role="status" className="mb-2 text-[12px] text-muted">
					{notice}
				</p>
			)}
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
				{!items.length && (
					<p className="p-2 text-[12px] text-muted" role="status">
						{empty}
					</p>
				)}
			</div>
		</div>
	);
}
