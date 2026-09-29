// ＋と # で同じ検索一覧・最近使用・キーボード操作を表示する。
import type { ComponentProps } from "react";
import { ContextPickerBreadcrumbs } from "./ContextPickerBreadcrumbs";
import type { WorkspacePath } from "../../../shared/workspacePaths";
import { CompletionMenu } from "./CompletionMenu";
import type { CompletionItem } from "./completionItems";
import { referenceIcon } from "./referencePresentation";
import { SettingsTooltip } from "../SettingsTooltip";

/** 選択済みの参照をチップとして再利用できる共通ピッカー。 */
export function ContextPicker({
	recent,
	onCategories,
	ancestors,
	onAncestor,
	...props
}: ComponentProps<typeof CompletionMenu> & {
	recent: CompletionItem[];
	onCategories: () => void;
	ancestors: WorkspacePath[];
	onAncestor: (depth: number) => void;
}) {
	return (
		<CompletionMenu
			{...props}
			context
			header={
				<>
					<div className="mb-2">
						<p className="m-0 mb-2 text-[11px] text-muted">
							最近使用
						</p>
						<div
							className="flex flex-wrap gap-1"
							aria-label="最近使用"
						>
							{recent.map((item) => {
								const Icon = item.reference
									? referenceIcon(item.reference)
									: undefined;
								return (
									<SettingsTooltip
										key={JSON.stringify(item.reference)}
										content={item.description}
										aboveMenu
									>
										<button
											type="button"
											onMouseDown={(event) =>
												event.preventDefault()
											}
											onClick={() => props.onPick(item)}
											className="inline-flex max-w-full items-center gap-1 rounded border border-solid border-panel-border bg-transparent px-2 py-1 text-[12px] text-input-text hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus"
										>
											{Icon && (
												<Icon
													size={14}
													className="shrink-0"
													aria-hidden="true"
												/>
											)}
											<span className="truncate">
												{item.label}
											</span>
										</button>
									</SettingsTooltip>
								);
							})}
							{!recent.length && (
								<span className="text-[12px] text-muted">
									まだありません
								</span>
							)}
						</div>
					</div>
					<hr className="m-0 mb-2 border-0 border-t border-solid border-panel-border" />
					<ContextPickerBreadcrumbs
						title={props.title}
						ancestors={ancestors}
						onCategories={onCategories}
						onAncestor={onAncestor}
					/>
				</>
			}
		/>
	);
}
