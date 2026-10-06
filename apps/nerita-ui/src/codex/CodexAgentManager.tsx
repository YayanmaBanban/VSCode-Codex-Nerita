// Codex の TOML 定義を、共通の一覧・フォームから編集する。
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import { AgentBrowser } from "../agentManager/AgentBrowser";
import { AgentSettings } from "../agentManager/AgentSettings";
import { AgentModelControl } from "../agentManager/AgentModelControl";
import { useAgentEditor } from "../agentManager/useAgentEditor";
import type { AgentManagerProps } from "../agentManager/managerProps";
import { CodexAgentPermissions } from "./CodexAgentPermissions";

/** 定義の選択・保存・再読み込みに応じて編集内容を作り直す。 */
export function CodexAgentManager(props: AgentManagerProps) {
	const agents = props.state.agents.filter(
		(agent) => agent.backend === "codex",
	);
	const agent =
		agents.find((item) => item.id === props.selected) ?? agents[0];
	const creating = props.selected === "new";
	return (
		<AgentBrowser
			agents={agents}
			selected={creating ? "new" : (agent?.id ?? "")}
			onSelect={props.onSelect}
			busy={props.busy}
		>
			{creating || agent ? (
				<CodexAgentEditor
					key={`${creating ? "new" : agent?.id}:${props.state.generation}`}
					{...props}
					agent={creating ? undefined : agent}
				/>
			) : (
				<p className="text-sm text-muted">
					「新しい Agent」から定義を作成できます。
				</p>
			)}
		</AgentBrowser>
	);
}

/** Codex 固有の保存キーへの対応を、このフォームに閉じ込める。 */
function CodexAgentEditor({
	agent,
	...props
}: AgentManagerProps & { agent?: ManagedAgent | undefined }) {
	const { edit, change, models, settings } = useAgentEditor(
		props,
		agent,
		"codex",
		() => codexDraft(agent?.edit),
	);
	return (
		<AgentSettings {...settings}>
			<AgentModelControl
				allowUnspecified={false}
				models={models}
				model={edit.model}
				effort={edit.reasoningEffort}
				disabled={props.busy || agent?.editable === false}
				onChange={(key, value) =>
					change(
						key === "model"
							? { ...edit, model: value }
							: {
									...edit,
									reasoningEffort:
										agentEditSchema.shape.reasoningEffort.parse(
											value,
										),
								},
					)
				}
			/>
			<CodexAgentPermissions
				edit={edit}
				onChange={change}
				disabled={props.busy || agent?.editable === false}
			/>
		</AgentSettings>
	);
}

/** TOML にない設定だけを補い、保存時は表示した値を明示的に書き込む。 */
function codexDraft(
	edit: AgentEdit = { definition: { name: "", description: "", prompt: "" } },
): AgentEdit {
	return {
		...edit,
		model: edit.model ?? "gpt-6.1-sol",
		reasoningEffort: edit.reasoningEffort ?? "medium",
		sandboxMode: edit.sandboxMode ?? "read-only",
		approvalsReviewer: edit.approvalsReviewer ?? "user",
		approvalPolicy: edit.approvalPolicy ?? "on-request",
	};
}
