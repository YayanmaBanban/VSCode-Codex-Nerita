// 設定項目と使用量に共通の、画面端を避けるツールチップを表示する。
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "cnfast";
import { useRef, type ReactElement, type ReactNode } from "react";

/** ホバーとフォーカスで説明を表示し、既存要素の操作と役割を維持する。 */
export function SettingsTooltip({
	children,
	content,
	aboveMenu = false,
}: {
	children: ReactElement;
	content?: ReactNode;
	aboveMenu?: boolean;
}) {
	const trigger = useRef<HTMLElement>(null);
	if (!content) {
		return children;
	}
	return (
		<Tooltip.Root
			onOpenChange={(_open, details) => {
				// 説明を閉じる際も、親のパネルや検索欄へ Escape を届ける。
				if (details.reason === "escape-key") {
					details.allowPropagation();
				}
			}}
		>
			<Tooltip.Trigger
				ref={(element: HTMLElement | null) => {
					trigger.current = element;
				}}
				render={children}
				delay={10}
			/>
			<Tooltip.Portal>
				<Tooltip.Positioner
					anchor={
						aboveMenu
							? () =>
									trigger.current?.closest(".config-popup") ??
									trigger.current
							: undefined
					}
					side="top"
					sideOffset={8}
					collisionPadding={12}
					className={cn(
						"settings-tooltip-positioner",
						aboveMenu ? "z-[60]" : "z-30",
					)}
				>
					<Tooltip.Popup
						className={cn(
							"settings-tooltip max-w-[min(280px,calc(100vw-24px))] rounded-[6px] border border-solid border-tooltip-border bg-tooltip px-[12px] py-[9px] shadow-[0_4px_16px_#0003]",
							"text-[12px] leading-[1.5] text-tooltip-text [overflow-wrap:anywhere]",
							"[&_hr]:mx-0 [&_hr]:my-[6px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-solid [&_hr]:border-tooltip-divider",
							"origin-[var(--transform-origin)] scale-100 opacity-100 transition-[transform,scale,opacity] duration-120 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:transition-none",
						)}
						role="tooltip"
					>
						{content}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
