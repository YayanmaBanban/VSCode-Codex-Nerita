<!-- Pi のエージェント定義とモデル・推論設定を編集し、共通の保存処理へ渡す。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { agentEditSchema } from "@nerita/shared/agentManager/config";
	import { type ManagedAgent } from "@nerita/shared/agentManager/messages";

	import AgentSettings from "../agentManager/AgentSettings.svelte";
	import AgentModelControl from "../agentManager/AgentModelControl.svelte";
	import EnabledField from "../agentManager/EnabledField.svelte";
	import { useAgentEditor } from "../agentManager/useAgentEditor.svelte";
	import { type AgentManagerProps } from "../agentManager/managerProps";

	let {
		agent,
		...props
	}: AgentManagerProps & { agent?: ManagedAgent | undefined } = $props();
	const editor = useAgentEditor(
		() => props,
		untrack(() => agent),
		"pi",
		() =>
			agent?.edit ?? {
				definition: { name: "", description: "", prompt: "" },
			},
	);
	let edit = $derived(editor.edit);
	let models = $derived(editor.models);
	let settings = $derived(editor.settings);
	const change = editor.change;
</script>

<AgentSettings {...settings}
	><AgentModelControl
		{models}
		model={edit.model}
		effort={edit.thinking}
		disabled={props.busy || agent?.editable === false}
		onChange={(
			key: "model" | "reasoning_effort",
			value: string | undefined,
		) =>
			change(
				key === "model"
					? { ...edit, model: value }
					: {
							...edit,
							thinking:
								agentEditSchema.shape.thinking.parse(value),
						},
			)}
	/>{#if agent}
		<EnabledField
			value={edit.disabled}
			onChange={(disabled: boolean | undefined) =>
				change({ ...edit, disabled })}
		/>
	{/if}</AgentSettings
>
