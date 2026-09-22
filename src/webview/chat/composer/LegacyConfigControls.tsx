// Contribution未対応のBridge向けに、従来のConfigOption表示だけを隔離する。
import type { ChatState } from "../../../shared/chatState";
import type { ConfigOption } from "../../../shared/composer";
import { ConfigControl, FastModeSwitch } from "./ConfigControl";
import { QuotaBar } from "./QuotaBar";

const order = [
	"mode",
	"collaboration_mode",
	"model",
	"reasoning_effort",
	"fast-mode",
];
const names = [
	"Mode",
	"Collaboration mode",
	"Model",
	"Reasoning effort",
	"Fast mode",
];

/** 互換経路だけに旧順序・未接続枠・Fast Modeの値変換を残す。 */
export function LegacyConfigControls({
	state,
	connected,
	disabled,
	onChange,
}: {
	state: ChatState;
	connected: boolean;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
}) {
	const options = order.map(
		(id, index) =>
			state.configOptions.find((option) => option.id === id) ??
			(id === "fast-mode"
				? state.configOptions.find((option) =>
						["service_tier", "server_tier"].includes(option.id),
					)
				: undefined) ??
			({
				id,
				name: names[index]!,
				currentValue: "",
				options: [],
			} satisfies ConfigOption),
	);
	options.push(
		...state.configOptions.filter(
			(option) =>
				!order.includes(option.id) &&
				!["service_tier", "server_tier"].includes(option.id),
		),
	);
	return (
		<>
			{options.map((option) =>
				["fast-mode", "service_tier", "server_tier"].includes(
					option.id,
				) ? (
					<span
						className="fast-mode-quota inline-flex items-center gap-[8px]"
						key={option.id}
					>
						<FastModeSwitch
							option={option}
							disabled={disabled}
							onChange={(value) => onChange(option.id, value)}
						/>
						<QuotaBar windows={connected ? state.quota : null} />
					</span>
				) : (
					<ConfigControl
						key={option.id}
						option={option}
						disabled={disabled}
						onChange={(value) => onChange(option.id, value)}
					/>
				),
			)}
		</>
	);
}
