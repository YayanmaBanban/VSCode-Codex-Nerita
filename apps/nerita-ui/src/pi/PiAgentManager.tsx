// Pi のプロジェクト定義と設定上書きを、共通の一覧・フォームから編集する。
import { agentEditSchema } from "@nerita/shared/agentManager/config";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import { AgentBrowser } from "../agentManager/AgentBrowser";
import { AgentSettings } from "../agentManager/AgentSettings";
import { AgentModelControl } from "../agentManager/AgentModelControl";
import { EnabledField } from "../agentManager/EnabledField";
import { useAgentEditor } from "../agentManager/useAgentEditor";
import type { AgentManagerProps } from "../agentManager/managerProps";
import { PiDefaultsSettings } from "./PiDefaultsSettings";

/** パッケージ・ユーザー定義ではプロジェクトの上書き設定だけを編集する。 */
export function PiAgentManager(props: AgentManagerProps) {
	const agents = props.state.agents.filter((agent) => agent.backend === "pi");
	const agent =
		agents.find((item) => item.id === props.selected) ?? agents[0];
	const creating = props.selected === "new";
	const defaults = props.selected === "defaults" || (!creating && !agent);
	const selectedId = defaults ? "defaults" : (agent?.id ?? "");
	const editorId = creating ? "new" : selectedId;
	return (
		<AgentBrowser
			agents={agents}
			selected={editorId}
			onSelect={props.onSelect}
			busy={props.busy}
			defaults
		>
			{defaults ? (
				<div onChangeCapture={props.onDirty}>
					<PiDefaultsSettings
						key={props.state.generation}
						defaults={props.state.piDefaults}
						models={props.state.models.pi}
						busy={props.busy}
						save={props.save}
					/>
				</div>
			) : (
				<PiAgentEditor
					key={`${editorId}:${props.state.generation}`}
					{...props}
					agent={creating ? undefined : agent}
				/>
			)}
			<details className="mt-6">
				<summary className="cursor-pointer text-sm">
					User 設定・Model scope（閲覧のみ）
				</summary>
				<pre className="overflow-auto text-xs">
					{props.state.piUserSettings}
				</pre>
				<pre className="overflow-auto text-xs">
					{props.state.modelScope}
				</pre>
			</details>
		</AgentBrowser>
	);
}

/** Pi の推論キーと上書き指定を Codex の設定から分離する。 */
function PiAgentEditor({
	agent,
	...props
}: AgentManagerProps & { agent?: ManagedAgent | undefined }) {
	const { edit, change, models, settings } = useAgentEditor(
		props,
		agent,
		"pi",
		() =>
			agent?.edit ?? {
				definition: { name: "", description: "", prompt: "" },
			},
	);
	return (
		<AgentSettings {...settings}>
			<AgentModelControl
				models={models}
				model={edit.model}
				effort={edit.thinking}
				disabled={props.busy || agent?.editable === false}
				onChange={(key, value) =>
					change(
						key === "model"
							? { ...edit, model: value }
							: {
									...edit,
									thinking:
										agentEditSchema.shape.thinking.parse(
											value,
										),
								},
					)
				}
			/>
			{agent && (
				<EnabledField
					value={edit.disabled}
					onChange={(disabled) => change({ ...edit, disabled })}
				/>
			)}
		</AgentSettings>
	);
}
