// Pi の Workspace override と Codex の標準 TOML を、同じフォームから編集する。
import { useState } from "react";
import {
	agentEditSchema,
	type AgentEdit,
} from "../../shared/agentManager/config";
import type {
	ManagedAgent,
	ManagerModel,
} from "../../shared/agentManager/messages";
import type { ManagerSave } from "./useAgentManager";
import { ModelField, EffortField, buttonStyle } from "./Fields";
import { AgentDetails, EnabledField } from "./AgentDetails";
import { effortError, effortOptions } from "../../shared/agentManager/effort";

/** モデルと推論以外の定義本文を保存要求へ含めない。 */
export function AgentSettings({
	agent,
	models,
	busy,
	save,
}: {
	agent: ManagedAgent;
	models: ManagerModel[];
	busy: boolean;
	save: ManagerSave;
}) {
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
					className={`${buttonStyle} justify-self-start`}
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
