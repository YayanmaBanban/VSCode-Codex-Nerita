// モデルカード内で速度設定を切り替え、状態に応じた同梱アイコンを表示する。
import { cn } from "cnfast";
import offIcon from "../../media/icons/fastmode-off.svg?raw";
import onIcon from "../../media/icons/fastmode-on.svg?raw";
import type { NeritaUiControl } from "@nerita/shared/uiContributions";
import { SettingsTooltip } from "../chat/SettingsTooltip";

/** 対応していないモデルでは無効にし、Host の選択値を送る。 */
export function FastModeButton({
	control,
	disabled,
	onChange,
}: {
	control: NonNullable<
		Extract<NeritaUiControl, { type: "slider-card" }>["fastMode"]
	>;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
}) {
	return (
		<SettingsTooltip
			content={
				<span className="whitespace-pre-line">
					{"ファストモード\n速度1.5倍、使用量が増えます"}
				</span>
			}
		>
			<button
				type="button"
				role="switch"
				aria-label="ファストモード"
				aria-checked={control.checked}
				disabled={disabled || control.disabled}
				className={cn(
					"inline-flex size-[28px] items-center justify-center rounded-[5px] border",
					"border-solid border-input-border bg-input p-0 text-muted",
					"focus-visible:outline-1 focus-visible:outline-settings-focus",
					"enabled:hover:bg-settings-hover",
					"disabled:opacity-50",
				)}
				onClick={() =>
					onChange(
						control.configId,
						control.checked ? control.offValue : control.onValue,
					)
				}
			>
				<span
					aria-hidden="true"
					className={cn("inline-flex", "[&_svg]:size-[16px]")}
					dangerouslySetInnerHTML={{
						__html: control.checked ? onIcon : offIcon,
					}}
				/>
			</button>
		</SettingsTooltip>
	);
}
