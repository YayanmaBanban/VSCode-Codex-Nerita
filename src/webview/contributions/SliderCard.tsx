// 段階選択と追加設定を、アイコンから開く小さなカードへまとめる。
import { Popover } from "@base-ui/react/popover";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Bot, User, Shield, ShieldAlert } from "lucide-react";
import { cn } from "cnfast";
import type { NeritaUiControl } from "../../shared/uiContributions";
import { SettingsTooltip } from "../chat/SettingsTooltip";
import { StepSlider } from "../ui/StepSlider";
import { ConfigControl } from "../chat/composer/ConfigControl";

/** 候補の並び順をスライダーの段階として扱い、選択値だけを Host へ送る。 */
export function SliderCard({
	control,
	disabled,
	onChange,
}: {
	control: Extract<NeritaUiControl, { type: "slider-card" }>;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
}) {
	const { option, secondary } = control;
	const index = option.options.findIndex(
		(choice) => choice.value === option.currentValue,
	);
	const current = option.options[index];
	const label = current?.name ?? option.currentLabel ?? option.name;
	const unavailable = disabled || !option.options.length;
	const Icon = control.icon === "shield-alert" ? ShieldAlert : Shield;
	return (
		<CSPProvider disableStyleElements>
			<Popover.Root>
				<SettingsTooltip
					content={
						<CardTooltip label={label} secondary={secondary} />
					}
				>
					<Popover.Trigger
						aria-label={option.name}
						disabled={unavailable}
						className={cn(
							"inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 enabled:hover:bg-settings-hover focus-visible:outline-1 focus-visible:outline-settings-focus disabled:opacity-50",
							control.warning ? "text-warning" : "text-muted",
						)}
					>
						<Icon size={16} aria-hidden="true" />
					</Popover.Trigger>
				</SettingsTooltip>
				<Popover.Portal>
					<Popover.Positioner
						side="top"
						align="start"
						sideOffset={8}
						collisionPadding={12}
						className="z-20"
					>
						<Popover.Popup
							aria-label={option.name}
							className="w-[min(256px,calc(100vw-24px))] rounded-[18px] border border-solid border-menu-border bg-menu p-[12px] text-menu-text shadow-[0_6px_24px_#0003]"
						>
							<div className="relative flex min-h-[36px] items-center justify-center pb-[8px]">
								{secondary && (
									<div className="absolute top-0 left-0">
										<ConfigControl
											option={secondary.option}
											icon={secondary.icon}
											disabled={disabled}
											onChange={(value) =>
												onChange(
													secondary.option.id,
													value,
												)
											}
										/>
									</div>
								)}
								<Popover.Title
									className={cn(
										"m-0 px-[28px] text-center text-[12px] font-medium",
										control.warning && "text-warning",
									)}
								>
									{label}
								</Popover.Title>
							</div>
							<StepSlider
								value={Math.max(0, index)}
								count={option.options.length}
								label={option.name}
								valueText={label}
								disabled={unavailable}
								onChange={(value) => {
									const choice = option.options[value];
									if (choice) {
										onChange(option.id, choice.value);
									}
								}}
							/>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</CSPProvider>
	);
}

/** 追加設定がある段階では、その現在のアイコンを説明の左に添える。 */
function CardTooltip({
	label,
	secondary,
}: {
	label: string;
	secondary: Extract<NeritaUiControl, { type: "slider-card" }>["secondary"];
}) {
	const Icon = secondary?.icon === "user" ? User : Bot;
	return (
		<span className="inline-flex items-center gap-[6px]">
			{secondary && <Icon size={16} aria-hidden="true" />}
			<span>{label}</span>
		</span>
	);
}
