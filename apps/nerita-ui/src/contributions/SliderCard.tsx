// 段階選択と追加設定を、アイコンから開く小さなカードへまとめる。
import { Popover } from "@base-ui/react/popover";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Bot, User, Shield, ShieldAlert, ChevronDown } from "lucide-react";
import { cn } from "cnfast";
import type { NeritaUiControl } from "@nerita/shared/uiContributions";
import { SettingsTooltip } from "../chat/SettingsTooltip";
import { StepSlider } from "../ui/StepSlider";
import { ConfigControl } from "../chat/composer/ConfigControl";
import { FastModeButton } from "./FastModeButton";
import type { ConfigOption } from "@nerita/shared/composer";
import fastModeOn from "../../../../media/icons/fastmode-on.svg?raw";
import { useState } from "react";

const reasoningDescriptions: Record<string, string> = {
	low: "軽い推論。速度とコストを、優先します。",
	medium: "品質と速度の、バランスを取ります。",
	high: "複雑な実装やデバッグを、より深く検討します。",
	xhigh: "難易度の高い実装や、レビュー向けです。",
	max: "最難関の問題向けに、推論能力を最大限使用します。",
	ultra: "複雑な作業を必要に応じて、複数のエージェントへ委譲します。\n使用量が大きく、増える場合があります。",
};

/** カード内の操作を同じ設定送信先へ接続する。 */
type CardProps = {
	control: Extract<NeritaUiControl, { type: "slider-card" }>;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
};

/** 未取得の選択値には設定名を表示する。 */
function optionLabel(option: ConfigOption) {
	return (
		option.options.find((choice) => choice.value === option.currentValue)
			?.name ??
		option.currentLabel ??
		option.name
	);
}

/** 候補の並び順をスライダーの段階として扱い、選択値だけを Host へ送る。 */
export function SliderCard({ control, disabled, onChange }: CardProps) {
	const [preview, setPreview] = useState<number | null>(null);
	const { option, model } = control;
	const displayed =
		preview === null
			? control
			: {
					...control,
					option: {
						...option,
						currentValue:
							option.options[preview]?.value ??
							option.currentValue,
					},
				};
	const index = option.options.findIndex(
		(choice) => choice.value === option.currentValue,
	);
	const label = optionLabel(option);
	const unavailable = disabled || !(model ?? option).options.length;
	return (
		<CSPProvider disableStyleElements>
			<Popover.Root onOpenChange={() => setPreview(null)}>
				<SettingsTooltip
					content={<CardTooltip label={label} control={control} />}
				>
					{cardTrigger(control, unavailable)}
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
							<CardHeader
								control={displayed}
								disabled={disabled}
								onChange={onChange}
							/>
							<StepSlider
								value={Math.max(0, index)}
								count={option.options.length}
								label={option.name}
								valueText={optionLabel(displayed.option)}
								onPreview={setPreview}
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

/** モデルカードは選択値を、権限カードはアイコンを入口に表示する。 */
function cardTrigger(control: CardProps["control"], disabled: boolean) {
	const { model, option } = control;
	const Icon = control.icon === "shield-alert" ? ShieldAlert : Shield;
	return (
		<Popover.Trigger
			aria-label={model ? "モデルと推論レベル" : option.name}
			disabled={disabled}
			className={cn(
				"inline-flex h-[28px] min-w-0 shrink items-center justify-center rounded-[5px] border-0 bg-transparent enabled:hover:bg-settings-hover focus-visible:outline-1 focus-visible:outline-settings-focus disabled:opacity-50",
				model
					? "gap-[6px] px-[5px] text-[12px] font-medium"
					: "w-[28px] shrink-0 p-0",
				control.warning ? "text-warning" : "text-muted",
			)}
		>
			{model ? (
				<>
					<span className="truncate">
						{optionLabel(model)} {option.currentValue}
					</span>
					{control.fastMode?.checked && (
						<span
							aria-hidden="true"
							className="inline-flex shrink-0 [&_svg]:size-[14px]"
							dangerouslySetInnerHTML={{ __html: fastModeOn }}
						/>
					)}
					<ChevronDown
						size={12}
						className="shrink-0"
						aria-hidden="true"
					/>
				</>
			) : (
				<Icon size={16} aria-hidden="true" />
			)}
		</Popover.Trigger>
	);
}

/** 現在の段階と、そのカードに関連する設定をまとめる。 */
function CardHeader({ control, disabled, onChange }: CardProps) {
	const { option, model, secondary, fastMode } = control;
	return (
		<div className="relative flex min-h-[36px] items-center justify-center pb-[8px]">
			{fastMode && (
				<div className="absolute top-0 left-0">
					<FastModeButton
						control={fastMode}
						disabled={disabled}
						onChange={onChange}
					/>
				</div>
			)}
			{secondary && (
				<div className="absolute top-0 left-0">
					<ConfigControl
						option={secondary.option}
						icon={secondary.icon}
						disabled={disabled}
						onChange={(value) =>
							onChange(secondary.option.id, value)
						}
					/>
				</div>
			)}
			<div className="flex min-w-0 flex-col items-center px-[28px]">
				<Popover.Title
					className={cn(
						"m-0 text-center text-[12px] font-medium",
						model && "text-link",
						control.warning && "text-warning",
					)}
				>
					{optionLabel(option)}
				</Popover.Title>
				{model && (
					<ConfigControl
						option={model}
						chevron="right"
						disabled={disabled}
						onChange={(value) => onChange(model.id, value)}
					/>
				)}
			</div>
		</div>
	);
}

/** モデルは推論量の説明だけを表示し、権限は現在値と承認者を表示する。 */
function CardTooltip({
	label,
	control,
}: {
	label: string;
	control: CardProps["control"];
}) {
	if (control.model) {
		return (
			<span className="whitespace-pre-line">
				{reasoningDescriptions[control.option.currentValue]}
			</span>
		);
	}
	const { secondary } = control;
	const Icon = secondary?.icon === "user" ? User : Bot;
	return (
		<span className="inline-flex items-center gap-[6px]">
			{secondary && <Icon size={16} aria-hidden="true" />}
			<span>{label}</span>
		</span>
	);
}
