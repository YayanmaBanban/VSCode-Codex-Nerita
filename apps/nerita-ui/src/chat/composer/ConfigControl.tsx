// 設定候補の `name` を表示し、`value` だけを Host に送る。

import { CSPProvider } from "@base-ui/react/csp-provider";
import { Select } from "@base-ui/react/select";
import type { ConfigChoice, ConfigOption } from "@nerita/shared/composer";
import { cn } from "cnfast";
import { Bot, Check, ChevronDown, ChevronRight, User } from "lucide-react";
import { SettingsTooltip } from "../SettingsTooltip";

/** 設定の選択肢、変更通知とメニュー・アイコンの表示条件。 */
type ConfigControlProps = {
	option: ConfigOption;
	disabled: boolean;
	onChange: (value: string) => void;
	inDialog?: boolean;
	icon?: "user" | "bot" | undefined;
	chevron?: "down" | "right";
};

/** 各 `select` を同じ `ChevronDown` とキーボード操作で表示する。 */
export function ConfigControl({
	option,
	disabled,
	onChange,
	inDialog = false,
	icon,
	chevron = "down",
}: ConfigControlProps) {
	return (
		<div
			className={cn(
				"config-control relative inline-flex max-w-full min-w-0 text-muted",
			)}
		>
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
								"config-trigger inline-flex max-w-[170px] cursor-pointer items-center",
								"gap-[6px] rounded-[4px]",
								"[&_svg]:shrink-0",
								icon
									? "border border-solid border-input-border bg-input px-[4px] py-[5px]"
									: "border-0 bg-transparent px-[5px] py-[6px]",
								"text-[12px] text-ellipsis text-inherit",
								"enabled:hover:bg-settings-hover",
								"focus-visible:outline-1 focus-visible:outline-offset-1",
								"focus-visible:outline-settings-focus focus-visible:outline-solid",
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
					<ConfigOptions inDialog={inDialog} option={option} />
				</Select.Root>
			</CSPProvider>
		</div>
	);
}

/** 設定メニューの候補と、ダイアログ内に表示するかどうかの指定。 */
type ConfigOptionsProps = { inDialog: boolean; option: ConfigOption };

/** 設定候補をメニューに表示し、選択値と説明を提供する。 */
function ConfigOptions({ inDialog, option }: ConfigOptionsProps) {
	return (
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
						"config-popup max-h-[min(340px,var(--available-height))]",
						"w-[min(280px,calc(100vw-24px))] overflow-hidden",
						"rounded-[8px] border border-solid border-menu-border bg-menu",
						"text-menu-text shadow-[0_6px_24px_#0003]",
					)}
					aria-label={option.name}
				>
					<Select.List
						className={cn(
							"config-list max-h-[inherit] scroll-p-[5px] overflow-y-auto p-[5px]",
						)}
					>
						{option.options.map((choice) => (
							<SettingsTooltip
								key={choice.value}
								content={
									choice.icon ? undefined : choice.description
								}
								aboveMenu
							>
								<Select.Item
									value={choice.value}
									label={choice.name}
									className={cn(
										"config-item flex min-h-[36px] cursor-pointer items-center",
										"justify-between gap-[12px] rounded-[5px] px-[10px] py-[8px]",
										"text-[12px] leading-[1.5] [overflow-wrap:anywhere] [outline:none]",
										"hover:bg-menu-hover",
										"data-highlighted:bg-menu-hover",
									)}
								>
									<ChoiceLabel choice={choice} />
									<Select.ItemIndicator
										className={cn(
											"config-check inline-flex flex-[0_0_15px] text-menu-check",
										)}
									>
										<Check size={15} aria-hidden="true" />
									</Select.ItemIndicator>
								</Select.Item>
							</SettingsTooltip>
						))}
					</Select.List>
				</Select.Popup>
			</Select.Positioner>
		</Select.Portal>
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

/** 表示名・説明・アイコンを持つ設定候補。 */
type ChoiceLabelProps = { choice: ConfigChoice };

/** アイコン付きの候補では、説明も項目内に表示する。 */
function ChoiceLabel({ choice }: ChoiceLabelProps) {
	if (!choice.icon) {
		return <Select.ItemText>{choice.name}</Select.ItemText>;
	}
	const Icon = choice.icon === "user" ? User : Bot;
	return (
		<span className="flex min-w-0 items-center gap-[10px]">
			<Icon size={18} className="shrink-0" aria-hidden="true" />
			<span className="flex min-w-0 flex-col gap-[3px]">
				<Select.ItemText>{choice.name}</Select.ItemText>
				<span className="text-[11px] whitespace-pre-line text-muted">
					{choice.description}
				</span>
			</span>
		</span>
	);
}

/** 現在の設定値と、操作ボタンに表示するアイコン・矢印の指定。 */
type ControlLabelProps = {
	option: ConfigOption;
	icon?: "user" | "bot" | undefined;
	chevron: "down" | "right";
};

/** アイコン指定時だけ選択値と矢印を省略する。 */
function ControlLabel({ option, icon, chevron }: ControlLabelProps) {
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
