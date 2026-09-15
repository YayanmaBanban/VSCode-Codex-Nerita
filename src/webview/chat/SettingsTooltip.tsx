// 設定項目と使用量に共通の、画面端を避けるツールチップを表示する。
import { Tooltip } from "@base-ui/react/tooltip";
import { useRef, type ReactElement, type ReactNode } from "react";
import "./settingsPopup.css";

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
		<Tooltip.Root>
			<Tooltip.Trigger
				ref={(element: HTMLElement | null) => {
					trigger.current = element;
				}}
				render={children}
				delay={350}
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
					className="settings-tooltip-positioner"
				>
					<Tooltip.Popup className="settings-tooltip" role="tooltip">
						{content}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
