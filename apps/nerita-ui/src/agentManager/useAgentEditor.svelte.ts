// エージェント編集の下書きを保持し、検証済みの保存内容を管理画面へ返す。
import type { BackendId } from "@nerita/shared/backend";
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import { agentInputErrors } from "./agentValidation";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import type { AgentManagerProps } from "./managerProps";
/** `{#key}` 内の編集フォームが生成されたときだけ初期値を読み込み、保存失敗時は下書きを維持する。 */
export function useAgentEditor(
	input: AgentManagerProps | (() => AgentManagerProps),
	agent: ManagedAgent | undefined,
	backend: BackendId,
	initialEdit: () => AgentEdit,
) {
	/** 引数の形式にかかわらず、最新の管理画面の状態と操作先を取得する。 */
	const props = () => (typeof input === "function" ? input() : input);
	let edit = $state.raw<AgentEdit>(initialEdit());
	let filename = $state("");
	/** エージェントの下書きを更新し、未保存の変更があることを親へ伝える。 */
	const change = (next: AgentEdit) => {
		edit = next;
		props().onDirty();
	};
	return {
		get edit() {
			return edit;
		},
		change,
		get models() {
			return props().state.models[backend];
		},
		get settings() {
			const current = props();
			const models = current.state.models[backend];
			return {
				agent,
				edit,
				models,
				...agentInputErrors(
					current.state,
					backend,
					edit,
					agent,
					agent ? undefined : filename,
				),
				onChange: change,
				busy: current.busy,
				dirty: current.dirty,
				saved: current.saved,
				onDiscard: current.onDiscard,
				filename,
				onFilenameChange: agent
					? undefined
					: (value: string) => {
							filename = value;
							props().onDirty();
						},
				onSubmit: () => {
					const parsed = agentEditSchema.parse(edit);
					props().save(
						agent
							? { type: "agent", agentId: agent.id, edit: parsed }
							: {
									type: "createAgent",
									backend,
									filename,
									edit: parsed,
								},
					);
				},
			};
		},
	};
}
