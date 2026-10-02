// Pi の `Workspace override` と Codex の標準 TOML を、同じフォームから編集する。

import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import { effortError, effortOptions } from "@nerita/shared/agentManager/effort";
import type {
	ManagedAgent,
	ManagerModel,
} from "@nerita/shared/agentManager/messages";
import { cn } from "cnfast";
import { useState, type Dispatch, type SetStateAction } from "react";
import { AgentDetails, EnabledField } from "./AgentDetails";
import { EffortField, ModelField, buttonStyle } from "./Fields";
import type { ManagerSave } from "./useAgentManager";

/** 編集するエージェント定義、モデル候補、保存操作と処理中の状態。 */
type AgentSettingsProps = {
	agent: ManagedAgent;
	models: ManagerModel[];
	busy: boolean;
	save: ManagerSave;
};

/** モデル・推論などの設定だけを保存し、定義の本文を保存要求に含めない。 */
export function AgentSettings({
	agent,
	models,
	busy,
	save,
}: AgentSettingsProps) {
	const [edit, setEdit] = useState<AgentEdit>(agent.edit);
	const pi = agent.backend === "pi";
	const effort = pi
		? {
				key: "thinking" as const,
				label: "Thinking",
				options: effortOptions(models, edit.model),
			}
		: {
				key: "reasoningEffort" as const,
				label: "Reasoning effort",
				options: effortOptions(models, edit.model),
			};
	const error = effortError(
		models,
		edit.model,
		edit[effort.key],
		agent.edit.model,
		agent.edit[effort.key],
	);
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (error) {
					return;
				}
				save({
					type: "agent",
					agentId: agent.id,
					edit: agentEditSchema.parse(edit),
				});
			}}
		>
			<div>
				<h2 className="m-0 break-words text-lg font-semibold">
					{agent.name}
				</h2>
				<p className="break-words text-sm text-muted">
					{agent.description}
				</p>
			</div>
			<AgentDetails agent={agent} />
			{agent.unavailableReason && (
				<p role="status" className="text-sm text-muted">
					Unsupported: {agent.unavailableReason}
				</p>
			)}
			{AgentFields(busy, agent, pi, edit, setEdit, models, effort, error)}
			<p className="m-0 break-all text-xs text-muted">
				保存先: {pi ? ".pi/settings.json" : agent.id}
			</p>
			{!pi && (
				<p className="m-0 text-xs text-muted">
					Codex の個別 Agent
					の有効／無効は、この画面では変更しません。
				</p>
			)}
		</form>
	);
}

function AgentFields(
	busy: boolean,
	agent: ManagedAgent,
	pi: boolean,
	edit: AgentEdit,
	setEdit: Dispatch<SetStateAction<AgentEdit>>,
	models: ManagerModel[],
	effort:
		| { key: "thinking"; label: string; options: string[] }
		| { key: "reasoningEffort"; label: string; options: string[] },
	error: string | undefined,
) {
	return (
		<fieldset
			disabled={busy || !agent.editable}
			className="m-0 grid min-w-0 gap-4 border-0 p-0"
		>
			<legend className="mb-3 text-sm font-semibold">
				{pi ? "Workspace override" : "Agent 設定"}
			</legend>
			{pi && (
				<EnabledField
					value={edit.disabled}
					onChange={(disabled) => setEdit({ ...edit, disabled })}
				/>
			)}
			<ModelField
				value={edit.model}
				models={models}
				onChange={(model) => setEdit({ ...edit, model })}
			/>
			<EffortField
				label={effort.label}
				value={edit[effort.key]}
				options={effort.options}
				onChange={(value) =>
					setEdit(
						agentEditSchema.parse({
							...edit,
							[effort.key]: value,
						}),
					)
				}
			/>
			{models.length === 0 && (
				<p className="m-0 text-xs text-muted">
					モデル一覧がありません。認証設定を確認して再読み込みしてください。
				</p>
			)}
			<button
				disabled={!!error}
				className={cn(buttonStyle, "justify-self-start")}
				type="submit"
			>
				Agent 設定を保存
			</button>
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
		</fieldset>
	);
}
