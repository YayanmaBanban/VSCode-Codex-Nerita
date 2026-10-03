// 候補の種別に応じたアイコンと、選択状態を表示する。
import { cn } from "cnfast";
import { FolderOpen } from "lucide-react";
import type { CompletionItem } from "./completionItems";
import { contextCategories } from "./contextCategories";
import { referenceIcon } from "./referencePresentation";
import { SettingsTooltip } from "../SettingsTooltip";

/** カテゴリは横一列、通常の補完は説明を下段に表示する。 */
export function CompletionOption({
	id,
	item,
	selected,
	context,
	onPick,
}: {
	id: string;
	item: CompletionItem;
	selected: boolean;
	context: boolean;
	onPick: (item: CompletionItem) => void;
}) {
	return (
		<SettingsTooltip
			aboveMenu
			content={
				<span className="whitespace-pre-line">
					{[item.label, item.description].filter(Boolean).join("\n")}
				</span>
			}
		>
			<div
				id={id}
				role="option"
				aria-selected={selected}
				aria-label={item.category ? item.label : undefined}
				aria-disabled={item.disabled}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => {
					if (!item.disabled) {
						onPick(item);
					}
				}}
				className={cn(
					"cursor-pointer rounded border border-transparent p-2",
					"[overflow-wrap:anywhere]",
					context && "flex items-center gap-2",
					item.disabled && "cursor-not-allowed opacity-50",
					selected
						? "border-settings-focus bg-settings-hover"
						: "hover:bg-settings-hover",
				)}
			>
				<CompletionOptionLabel item={item} context={context} />
			</div>
		</SettingsTooltip>
	);
}

/** 長いファイル名も候補行の幅に収める。 */
function CompletionOptionLabel({
	item,
	context,
}: {
	item: CompletionItem;
	context: boolean;
}) {
	const Icon = context ? completionIcon(item) : undefined;
	return (
		<>
			{Icon && <Icon size={16} className="shrink-0" aria-hidden="true" />}
			<span
				className={cn(
					context && "min-w-0 text-[12px]",
					item.category ? "shrink-0" : "truncate",
				)}
			>
				{item.label}
			</span>
			{item.description && (
				<span
					className={cn(
						"text-[12px] text-muted",
						context ? "min-w-0 truncate" : "line-clamp-2 block",
					)}
				>
					{item.description}
				</span>
			)}
		</>
	);
}

/** 参照候補では本文チップと同じアイコンを使う。 */
function completionIcon(item: CompletionItem) {
	if (item.reference) {
		return referenceIcon(item.reference);
	}
	if (item.directory) {
		return FolderOpen;
	}
	return contextCategories.find((entry) => entry.label === item.category)
		?.icon;
}
