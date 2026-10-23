<!-- Pi のエージェント定義とモデル・推論設定を編集し、共通の保存処理へ渡す。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
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
	/** モデルの指定を解除する際は、そのモデルに対する推論指定も解除する。 */
	function changeOption(
		key: "model" | "reasoning_effort",
		value: string | undefined,
	) {
		if (key === "model") {
			change({
				...edit,
				model: value,
				thinking: value === undefined ? undefined : edit.thinking,
			});
			return;
		}
		change({
			...edit,
			thinking: agentEditSchema.shape.thinking.parse(value),
		});
	}
</script>

<AgentSettings {...settings}>
	{#snippet children({ error })}
		<AgentModelControl
			{error}
			{models}
			model={edit.model}
			effort={edit.thinking}
			disabled={props.busy || agent?.editable === false}
			onChange={changeOption}
		/>
		{#if !isNonEmptyString(edit.model)}
			<p class="m-0 text-xs text-muted">
				未指定の場合、モデルは親のモデルを使用し、推論レベルはバックエンドの既定値に任せます。
			</p>
		{:else}
			{#if edit.thinking === undefined}
				<p class="m-0 text-xs text-muted">
					推論レベルが未指定の場合、バックエンドの既定値に任せます。
				</p>
			{/if}
		{/if}
		{#if agent}
			<EnabledField
				value={edit.disabled}
				onChange={(disabled: boolean | undefined) =>
					change({ ...edit, disabled })}
			/>
		{/if}
	{/snippet}
</AgentSettings>
