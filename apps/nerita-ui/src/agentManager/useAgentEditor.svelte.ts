// エージェント編集の下書きを保持し、検証済みの保存内容を管理画面へ返す。
import type { BackendId } from "@nerita/shared/backend";
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import { agentInputErrors } from "./agentValidation";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import type { AgentManagerProps } from "./managerProps";
import { registerDraftEditor } from "./managerDraftContext";
import type { DraftChange } from "@nerita/shared/agentManager/draft";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
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
	const restored = registerAgentDraft(
		agent,
		backend,
		() => edit,
		() => filename,
		() => validAgentDraft(props(), backend, agent, edit, filename),
	);
	if (restored) {
		edit = restored.edit;
		filename = restored.type === "createAgent" ? restored.filename : "";
	}
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

/** 表示中のエージェントに一致する下書きだけを復元し、元の設定と編集値の取得先を登録する。 */
function registerAgentDraft(
	agent: ManagedAgent | undefined,
	backend: BackendId,
	edit: () => AgentEdit,
	filename: () => string,
	canSave: () => boolean,
) {
	const base: DraftChange | null = agent
		? { type: "agent", agentId: agent.id, edit: agent.edit }
		: null;
	const context = registerDraftEditor({
		canSave,
		capture: () => ({
			version: 1,
			backend,
			base,
			change: agent
				? { type: "agent", agentId: agent.id, edit: edit() }
				: {
						type: "createAgent",
						backend,
						filename: filename(),
						edit: edit(),
					},
		}),
		submit: () =>
			document
				.querySelector<HTMLFormElement>("main form")
				?.requestSubmit(),
	});
	return matchingAgentDraft(context?.restored?.change, agent, backend);
}
/** 保存ボタンと移動確認で、同じ必須値・モデル候補・重複の検証を使う。 */
function validAgentDraft(
	props: AgentManagerProps,
	backend: BackendId,
	agent: ManagedAgent | undefined,
	edit: AgentEdit,
	filename: string,
) {
	const errors = agentInputErrors(
		props.state,
		backend,
		edit,
		agent,
		agent ? undefined : filename,
	);
	return (
		agentEditSchema.safeParse(edit).success &&
		!Object.values(errors).some(isNonEmptyString)
	);
}
/** 別のフォーム用の下書きを、選択中のエージェントへ適用しない。 */
function matchingAgentDraft(
	restored: DraftChange | undefined,
	agent: ManagedAgent | undefined,
	backend: BackendId,
) {
	if (restored?.type === "agent" && restored.agentId === agent?.id) {
		return restored;
	}
	const creating =
		restored?.type === "createAgent" &&
		!agent &&
		restored.backend === backend;
	return creating ? restored : undefined;
}
