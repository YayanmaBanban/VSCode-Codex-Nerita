// オプションの先頭からサイドバーの保存済み配置を選択する。
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight, Columns2 } from "lucide-react";
import type { SidebarLocation } from "../../shared/sidebar";

/** ホバー待機とキーボード操作を同じサブメニューで扱う。 */
export function SidebarMenu({
	location,
	onSelect,
}: {
	location: SidebarLocation;
	onSelect: (location: SidebarLocation) => void;
}) {
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger
				openOnHover
				delay={300}
				className="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-highlighted:bg-menu-hover"
			>
				<Columns2 size={16} aria-hidden="true" />
				サイドバー
				<ChevronRight
					size={14}
					className="ml-auto"
					aria-hidden="true"
				/>
			</Menu.SubmenuTrigger>
			<Menu.Portal>
				<Menu.Positioner
					side="left"
					align="start"
					sideOffset={4}
					collisionPadding={8}
					className="z-30"
				>
					<Menu.Popup className="min-w-[128px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px] text-menu-text shadow-[0_6px_24px_#0003]">
						<Menu.RadioGroup
							value={location}
							onValueChange={(value) =>
								onSelect(value as SidebarLocation)
							}
						>
							{(
								[
									["primary", "プライマリ"],
									["secondary", "セカンダリ"],
								] as const
							).map(([value, label]) => (
								<Menu.RadioItem
									key={value}
									value={value}
									closeOnClick
									className="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-highlighted:bg-menu-hover"
								>
									<span className="size-[16px] shrink-0">
										<Menu.RadioItemIndicator>
											<Check
												size={16}
												className="text-[var(--vscode-testing-iconPassed,#4caf78)]"
												aria-hidden="true"
											/>
										</Menu.RadioItemIndicator>
									</span>
									{label}
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.SubmenuRoot>
	);
}
