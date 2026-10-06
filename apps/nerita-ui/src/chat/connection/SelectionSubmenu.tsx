// オプションメニューの設定選択を共通のサブメニューで表示する。
import { Menu } from "@base-ui/react/menu";
import { cn } from "cnfast";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** 設定の選択肢・表示内容と、選択操作・無効状態。 */
type SelectionSubmenuProps<Value extends string> = {
	label: string;
	icon: ReactNode;
	value: Value | undefined;
	options: readonly (readonly [Value, string])[];
	onSelect: (value: Value) => void;
	disabled?: boolean;
};

/** 選択肢は呼び出し側の設定値の型に合わせる。選択操作は呼び出し側で無効にできる。 */
export function SelectionSubmenu<Value extends string>({
	label,
	icon,
	value,
	options,
	onSelect,
	disabled = false,
}: SelectionSubmenuProps<Value>) {
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger
				openOnHover
				delay={300}
				className={cn(
					"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px]",
					"text-[12px] outline-none data-highlighted:bg-menu-hover",
				)}
			>
				{icon}
				{label}
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
					<Menu.Popup
						className={cn(
							"min-w-[128px] rounded-[6px] border border-solid border-menu-border",
							"bg-menu p-[5px] text-menu-text shadow-[0_6px_24px_#0003]",
						)}
					>
						<Menu.RadioGroup
							value={value ?? ""}
							onValueChange={(next) => onSelect(next as Value)}
						>
							{options.map(([option, name]) => (
								<Menu.RadioItem
									key={option}
									value={option}
									disabled={disabled}
									closeOnClick
									className={cn(
										"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px]",
										"text-[12px] outline-none data-highlighted:bg-menu-hover",
										"data-disabled:cursor-default data-disabled:opacity-50",
									)}
								>
									<span className="size-[16px] shrink-0">
										<Menu.RadioItemIndicator>
											<Check
												size={16}
												className="text-menu-check"
												aria-hidden="true"
											/>
										</Menu.RadioItemIndicator>
									</span>
									{name}
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.SubmenuRoot>
	);
}
