// providerを判定せず、検証済みcontrolの種別だけで描画する。
import type { NeritaUiControl } from "../../shared/uiContributions";
import { ConfigControl } from "../chat/composer/ConfigControl";
import { SettingsTooltip } from "../chat/SettingsTooltip";

/** select / toggleの操作値はHostが渡した候補に限定する。 */
export function ContributionRenderer({
	control,
	disabled,
	onChange,
}: {
	control: NeritaUiControl;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
}) {
	if (control.type === "select") {
		return (
			<ConfigControl
				option={control.option}
				disabled={disabled || !!control.disabled}
				onChange={(value) => onChange(control.option.id, value)}
			/>
		);
	}
	if (control.type === "toggle") {
		return (
			<SettingsTooltip content={control.description}>
				<label className="inline-flex items-center gap-[5px] px-[5px] text-[12px] text-muted">
					<span>{control.label}</span>
					<button
						type="button"
						role="switch"
						aria-label={control.label}
						aria-checked={control.checked}
						className="group h-[15px] w-[26px] shrink-0 rounded-[12px] border-0 bg-switch-off p-[2px] aria-checked:bg-switch-on"
						disabled={disabled || !!control.disabled}
						onClick={() =>
							onChange(
								control.configId,
								control.checked
									? control.offValue
									: control.onValue,
							)
						}
					>
						<span className="block size-[11px] rounded-full bg-foreground group-aria-checked:translate-x-[11px]" />
					</button>
				</label>
			</SettingsTooltip>
		);
	}
	return (
		<SettingsTooltip content={control.description}>
			<div className="inline-flex min-w-0 max-w-full items-center gap-[5px] px-[5px] text-[11px] text-muted">
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
