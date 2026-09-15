// 入力欄の下に添付・使用量・接続中の設定を指定順で配置する。
import { Plus } from "lucide-react";
import type { ChatState, UiMessage } from "../../shared/messages";
import type { ConfigOption } from "../../shared/composer";
import { ContextUsage } from "./ContextUsage";
import { QuotaBar } from "./QuotaBar";
import { ConfigControl, FastModeSwitch } from "./ConfigControl";
import { Attachments } from "./Attachments";

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

/** 未取得時も枠を残すが、候補と選択値は接続時の応答だけから構成する。 */
export function ComposerSettings({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const connected =
		state.connection === "ready" &&
		!!state.sessionId &&
		!state.sessionPending;
	const disabled = !connected || state.configPending;
	const options = order.map(
		(id, index) =>
			state.configOptions.find((option) => option.id === id) ??
			({
				id,
				name: names[index]!,
				currentValue: "",
				options: [],
			} satisfies ConfigOption),
	);
	options.push(
		...state.configOptions.filter((option) => !order.includes(option.id)),
	);
	/** 操作は現在の会話 ID と一意な要求 ID を添えて送る。 */
	const change = (configId: string, value: string) => {
		if (state.sessionId && connected) {
			send({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId: state.sessionId,
				configId,
				value,
			});
		}
	};
	return (
		<div className="composer-settings mt-[10px] border-0 border-t border-solid border-panel-border pt-[8px]">
			<Attachments
				files={state.attachments}
				disabled={!connected}
				onOpen={(attachmentId) =>
					send({
						type: "attachment/open",
						requestId: crypto.randomUUID(),
						sessionId: state.sessionId!,
						attachmentId,
					})
				}
				onRemove={(attachmentId) =>
					send({
						type: "attachment/remove",
						requestId: crypto.randomUUID(),
						sessionId: state.sessionId!,
						attachmentId,
					})
				}
			/>
			<div
				className="settings-toolbar flex flex-wrap items-center gap-x-[6px] gap-y-[4px]"
				aria-label="モデル設定"
			>
				<button
					type="button"
					className="attach-button flex border-0 bg-transparent p-[5px]"
					aria-label="ファイルを添付"
					title="ファイルを添付"
					disabled={!connected || state.attachmentPending}
					onClick={() =>
						send({
							type: "attachment/add",
							requestId: crypto.randomUUID(),
							sessionId: state.sessionId!,
						})
					}
				>
					<Plus size={16} aria-hidden="true" />
				</button>
				<ContextUsage
					key={state.sessionId ?? "disconnected"}
					usage={state.usage}
				/>
				{options.map((option) =>
					option.id === "fast-mode" ? (
						<span
							className="fast-mode-quota inline-flex items-center gap-[8px]"
							key={option.id}
						>
							<FastModeSwitch
								option={option}
								disabled={disabled}
								onChange={(value) => change(option.id, value)}
							/>
							<QuotaBar
								windows={connected ? state.quota : null}
							/>
						</span>
					) : (
						<ConfigControl
							key={option.id}
							option={option}
							disabled={disabled}
							onChange={(value) => change(option.id, value)}
						/>
					),
				)}
			</div>
		</div>
	);
}
