// Hostが解決した切替値を使い、汎用のスイッチを描画する。
import type { NeritaUiControl } from "../../shared/uiContributions";
import { SettingsTooltip } from "../chat/SettingsTooltip";

/** ラベル・無効状態・送信値はContributionの宣言に従う。 */
export function ToggleSwitch({
	control,
	disabled,
	onChange,
}: {
	control: Extract<NeritaUiControl, { type: "toggle" }>;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<SettingsTooltip content={control.description}>
			<label className="toggle-switch inline-flex items-center gap-[5px] px-[5px] text-[12px] text-muted">
				<span>{control.label}</span>
				<button
					type="button"
					role="switch"
					className="group h-[15px] w-[26px] shrink-0 rounded-[12px] border-0 bg-switch-off p-[2px] aria-checked:bg-switch-on"
					aria-label={control.label}
					aria-checked={control.checked}
					disabled={disabled || !!control.disabled}
					onClick={() =>
						onChange(
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
