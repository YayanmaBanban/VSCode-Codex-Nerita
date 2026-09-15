// 設定候補の name を表示し、value だけを Host に送る。
import { Check, ChevronDown } from "lucide-react";
import { Select } from "@base-ui/react/select";
import { CSPProvider } from "@base-ui/react/csp-provider";
import type { ConfigOption } from "../../shared/composer";
import { SettingsTooltip } from "./SettingsTooltip";

/** 各 select を同じ ChevronDown とキーボード操作で表示する。 */
export function ConfigControl({
	option,
	disabled,
	onChange,
}: {
	option: ConfigOption;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const current = option.options.find(
		(choice) => choice.value === option.currentValue,
	);
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
					<SettingsTooltip
						content={current?.description ?? option.description}
					>
						<Select.Trigger
							className="config-trigger inline-flex max-w-[170px] cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent px-[5px] py-[6px] text-[11px] text-ellipsis text-inherit enabled:hover:bg-settings-hover focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-settings-focus focus-visible:outline-offset-1 [&_svg]:shrink-0"
							aria-label={option.name}
						>
							<span className="truncate">
								{current?.name ?? option.name}
							</span>
							<ChevronDown size={12} aria-hidden="true" />
						</Select.Trigger>
					</SettingsTooltip>
					<Select.Portal>
						<Select.Positioner
							side="top"
							align="start"
							sideOffset={6}
							alignItemWithTrigger={false}
							collisionPadding={12}
							className="config-positioner z-20"
						>
							<Select.Popup
								className="config-popup w-[min(280px,calc(100vw-24px))] max-h-[min(340px,var(--available-height))] overflow-hidden rounded-[8px] border border-solid border-menu-border bg-menu text-menu-text shadow-[0_6px_24px_#0003]"
								aria-label={option.name}
							>
								<Select.List className="config-list max-h-[inherit] scroll-p-[5px] overflow-y-auto p-[5px]">
									{option.options.map((choice) => (
										<SettingsTooltip
											key={choice.value}
											content={choice.description}
											aboveMenu
										>
											<Select.Item
												value={choice.value}
												label={choice.name}
												className="config-item flex min-h-[36px] cursor-pointer items-center justify-between gap-[12px] rounded-[5px] px-[10px] py-[8px] text-[12px] leading-[1.5] [overflow-wrap:anywhere] [outline:none] hover:bg-menu-hover data-highlighted:bg-menu-hover"
											>
												<Select.ItemText>
													{choice.name}
												</Select.ItemText>
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

/** fast-mode の on/off 値を小さなスイッチで切り替える。 */
export function FastModeSwitch({
	option,
	disabled,
	onChange,
}: {
	option: ConfigOption;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const checked = option.currentValue === "on";
	const current = option.options.find(
		(choice) => choice.value === option.currentValue,
	);
	return (
		<SettingsTooltip content={current?.description ?? option.description}>
			<label className="fast-mode inline-flex items-center gap-[5px] px-[5px] text-[11px] text-muted">
				<span>{option.name}</span>
				<button
					type="button"
					role="switch"
					className="group h-[15px] w-[26px] rounded-[12px] border-0 bg-switch-off p-[2px] aria-checked:bg-switch-on"
					aria-label={option.name}
					aria-checked={checked}
					disabled={
						disabled ||
						!["on", "off"].every((value) =>
							option.options.some(
								(choice) => choice.value === value,
							),
						)
					}
					onClick={() => onChange(checked ? "off" : "on")}
				>
					<span className="block size-[11px] rounded-full bg-foreground group-aria-checked:translate-x-[11px]" />
				</button>
				<span className="fast-value min-w-[18px] text-[10px]">
					{current?.name ?? "—"}
				</span>
			</label>
		</SettingsTooltip>
	);
}
