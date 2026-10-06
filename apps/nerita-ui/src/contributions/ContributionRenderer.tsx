// プロバイダーを判定せず、検証済みコントロールの種別だけで描画する。
import { cn } from "cnfast";
import { ToggleSwitch } from "./ToggleSwitch";
import { SliderCard } from "./SliderCard";
import type { NeritaUiControl } from "@nerita/shared/uiContributions";
import { ConfigControl } from "../chat/composer/ConfigControl";
import { SettingsTooltip } from "../chat/SettingsTooltip";
import { QuotaBar } from "../chat/composer/QuotaBar";

/** 選択メニューとスイッチの操作値は Host が渡した候補に限定する。 */
export function ContributionRenderer({
	control,
	disabled,
	onChange,
}: {
	control: NeritaUiControl;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
}) {
	if (control.type === "slider-card") {
		return (
			<SliderCard
				control={control}
				disabled={disabled || !!(control.disabled === true)}
				onChange={onChange}
			/>
		);
	}
	if (control.type === "quota") {
		return <QuotaBar windows={control.windows} />;
	}
	if (control.type === "select") {
		return (
			<ConfigControl
				option={control.option}
				disabled={disabled || !!(control.disabled === true)}
				onChange={(value) => onChange(control.option.id, value)}
			/>
		);
	}
	if (control.type === "toggle") {
		return (
			<ToggleSwitch
				control={control}
				disabled={disabled}
				onChange={(value) => onChange(control.configId, value)}
			/>
		);
	}
	return (
		<SettingsTooltip content={control.description}>
			<div
				className={cn(
					"inline-flex max-w-full min-w-0 items-center gap-[5px] px-[5px] text-[11px]",
					"text-muted",
				)}
			>
				<span className="truncate">{control.label}</span>
				<progress
					aria-label={control.label}
					value={control.value}
					max={100}
					className="h-[5px] w-[48px] shrink-0 accent-current"
				/>
				<span>{Math.round(control.value)}%</span>
			</div>
		</SettingsTooltip>
	);
}
