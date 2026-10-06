// エージェントの下書きを保持し、編集通知と保存要求を組み立てる。
import { useState } from "react";
import type { BackendId } from "@nerita/shared/backend";
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import { effortError } from "@nerita/shared/agentManager/effort";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import type { AgentManagerProps } from "./managerProps";

/** 初期値は呼び出し側が指定する。既存の定義は名前を変更しても元のエージェント ID で保存を要求する。 */
export function useAgentEditor(
	props: AgentManagerProps,
	agent: ManagedAgent | undefined,
	backend: BackendId,
	initialEdit: () => AgentEdit,
) {
	const [edit, setEdit] = useState<AgentEdit>(initialEdit);
	const [filename, setFilename] = useState("");
	const models = props.state.models[backend];
	const effortKey = backend === "pi" ? "thinking" : "reasoningEffort";
	const change = (next: AgentEdit) => {
		setEdit(next);
		props.onDirty();
	};
	const settings = {
		agent,
		edit,
		models,
		onChange: change,
		busy: props.busy,
		error: effortError(
			models,
			edit.model,
			edit[effortKey],
			agent?.edit.model,
			agent?.edit[effortKey],
		),
		filename,
		onFilenameChange: agent
			? undefined
			: (value: string) => {
					setFilename(value);
					props.onDirty();
				},
		onSubmit: () => {
			const parsed = agentEditSchema.parse(edit);
			props.save(
				agent
					? { type: "agent", agentId: agent.id, edit: parsed }
					: { type: "createAgent", backend, filename, edit: parsed },
			);
		},
	};
	return { edit, change, models, settings };
}
