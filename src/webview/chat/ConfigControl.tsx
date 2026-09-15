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
		<div className="config-control">
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
							className="config-trigger"
							aria-label={option.name}
						>
							<span>{current?.name ?? option.name}</span>
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
							className="config-positioner"
						>
							<Select.Popup
								className="config-popup"
								aria-label={option.name}
							>
								<Select.List className="config-list">
									{option.options.map((choice) => (
										<SettingsTooltip
											key={choice.value}
											content={choice.description}
											aboveMenu
										>
											<Select.Item
												value={choice.value}
												label={choice.name}
												className="config-item"
											>
												<Select.ItemText>
													{choice.name}
												</Select.ItemText>
												<Select.ItemIndicator className="config-check">
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
			<label className="fast-mode">
				<span>{option.name}</span>
				<button
					type="button"
					role="switch"
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
					<span />
				</button>
				<span className="fast-value">{current?.name ?? "—"}</span>
			</label>
		</SettingsTooltip>
	);
}
