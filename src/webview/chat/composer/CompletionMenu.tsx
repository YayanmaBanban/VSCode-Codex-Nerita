// 検索ペインと候補ペインを持ち、選択中の行を見える範囲に保つ。
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import type { CompletionItem } from "./completions";

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
	onBack,
	location,
	notice,
	backLabel = "カテゴリへ戻る",
}: {
	id: string;
	title: string;
	query: string;
	items: CompletionItem[];
	selected: number;
	empty: string;
	onQuery: (text: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	onPick: (item: CompletionItem) => void;
	onBack?: (() => void) | undefined;
	location?: string | undefined;
	notice?: string | undefined;
	backLabel?: string;
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
			className={`absolute left-0 z-50 w-full min-w-0 rounded-[6px] border border-panel-border bg-input p-2 shadow-lg ${above ? "bottom-full mb-2" : "top-0"}`}
			role="region"
			aria-label={title}
		>
			<div className="mb-2 flex items-center gap-2 border-b border-panel-border pb-2">
				{onBack && (
					<button
						type="button"
						aria-label={backLabel}
						onMouseDown={(event) => event.preventDefault()}
						onClick={onBack}
					>
						←
					</button>
				)}
				<input
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
					<div
						key={item.id}
						id={`${id}-${index}`}
						role="option"
						title={
							item.description
								? `${item.label}\n${item.description}`
								: item.label
						}
						aria-selected={index === selected}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onPick(item)}
						className={`cursor-pointer rounded border border-transparent p-2 [overflow-wrap:anywhere] ${index === selected ? "bg-settings-hover border-settings-focus" : "hover:bg-settings-hover"}`}
					>
						<div>{item.label}</div>
						{item.description && (
							<div className="line-clamp-2 text-[12px] text-muted">
								{item.description}
							</div>
						)}
					</div>
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
