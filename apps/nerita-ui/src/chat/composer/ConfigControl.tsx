// 設定候補の `name` を表示し、`value` だけを Host に送る。
import { Bot, User, Check, ChevronDown, ChevronRight } from "lucide-react";
import { Select } from "@base-ui/react/select";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { cn } from "cnfast";
import type { ConfigChoice, ConfigOption } from "@nerita/shared/composer";
import { SettingsTooltip } from "../SettingsTooltip";

/** 各 `select` を同じ `ChevronDown` とキーボード操作で表示する。 */
export function ConfigControl({
	option,
	disabled,
	onChange,
	inDialog = false,
	icon,
	chevron = "down",
}: {
	option: ConfigOption;
	disabled: boolean;
	onChange: (value: string) => void;
	inDialog?: boolean;
	icon?: "user" | "bot" | undefined;
	chevron?: "down" | "right";
}) {
	return (
		<div className="config-control relative inline-flex min-w-0 max-w-full text-muted">
			{/* Webview の CSP に合わせ、スタイルは同梱 CSS から適用する。 */}
			<CSPProvider disableStyleElements>
				<Select.Root
					value={option.currentValue}
					disabled={disabled || !option.options.length}
					onValueChange={(value) => {
						if (value !== null) {
							onChange(value);
						}
					}}
				>
					<SettingsTooltip content={controlTooltip(option, icon)}>
						<Select.Trigger
							className={cn(
								"config-trigger inline-flex max-w-[170px] cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent px-[5px] py-[6px] [&_svg]:shrink-0",
								"text-[12px] text-ellipsis text-inherit enabled:hover:bg-settings-hover",
								"focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-settings-focus focus-visible:outline-offset-1",
							)}
							aria-label={option.name}
						>
							<ControlLabel
								option={option}
								icon={icon}
								chevron={chevron}
							/>
						</Select.Trigger>
					</SettingsTooltip>
					<Select.Portal>
						<Select.Positioner
							side="top"
							align="start"
							sideOffset={6}
							alignItemWithTrigger={false}
							collisionPadding={12}
							className={cn(
								"config-positioner",
								inDialog ? "z-[60]" : "z-20",
							)}
						>
							<Select.Popup
								className={cn(
									"config-popup w-[min(280px,calc(100vw-24px))] max-h-[min(340px,var(--available-height))] overflow-hidden",
									"rounded-[8px] border border-solid border-menu-border bg-menu text-menu-text shadow-[0_6px_24px_#0003]",
								)}
								aria-label={option.name}
							>
								<Select.List className="config-list max-h-[inherit] scroll-p-[5px] overflow-y-auto p-[5px]">
									{option.options.map((choice) => (
										<SettingsTooltip
											key={choice.value}
											content={
												choice.icon
													? undefined
													: choice.description
											}
											aboveMenu
										>
											<Select.Item
												value={choice.value}
												label={choice.name}
												className={cn(
													"config-item flex min-h-[36px] cursor-pointer items-center justify-between gap-[12px] rounded-[5px] px-[10px] py-[8px]",
													"text-[12px] leading-[1.5] [overflow-wrap:anywhere] [outline:none]",
													"hover:bg-menu-hover data-highlighted:bg-menu-hover",
												)}
											>
												<ChoiceLabel choice={choice} />
												<Select.ItemIndicator className="config-check inline-flex flex-[0_0_15px] text-menu-check">
													<Check
														size={15}
														aria-hidden="true"
													/>
												</Select.ItemIndicator>
											</Select.Item>
										</SettingsTooltip>
									))}
								</Select.List>
							</Select.Popup>
						</Select.Positioner>
					</Select.Portal>
				</Select.Root>
			</CSPProvider>
		</div>
	);
}

/** アイコン表示でも現在の選択値をツールチップで伝える。 */
function controlTooltip(option: ConfigOption, icon?: string) {
	const current = option.options.find(
		(choice) => choice.value === option.currentValue,
	);
	if (icon) {
		return current?.name ?? option.currentValue;
	}
	return current?.description ?? option.description;
}

/** アイコン付きの候補では、説明も項目内に表示する。 */
function ChoiceLabel({ choice }: { choice: ConfigChoice }) {
	if (!choice.icon) {
		return <Select.ItemText>{choice.name}</Select.ItemText>;
	}
	const Icon = choice.icon === "user" ? User : Bot;
	return (
		<span className="flex min-w-0 items-center gap-[10px]">
			<Icon size={18} className="shrink-0" aria-hidden="true" />
			<span className="flex min-w-0 flex-col gap-[3px]">
				<Select.ItemText>{choice.name}</Select.ItemText>
				<span className="whitespace-pre-line text-[11px] text-muted">
					{choice.description}
				</span>
			</span>
		</span>
	);
}

/** アイコン指定時だけ選択値と矢印を省略する。 */
function ControlLabel({
	option,
	icon,
	chevron,
}: {
	option: ConfigOption;
	icon?: "user" | "bot" | undefined;
	chevron: "down" | "right";
}) {
	if (icon) {
		const Icon = icon === "user" ? User : Bot;
		return <Icon size={16} aria-hidden="true" />;
	}
	const current = option.options.find(
		(choice) => choice.value === option.currentValue,
	);
	const Chevron = chevron === "right" ? ChevronRight : ChevronDown;
	return (
		<>
			<span className="truncate">
				{current?.name ?? option.currentLabel ?? option.name}
			</span>
			<Chevron size={12} aria-hidden="true" />
		</>
	);
}
