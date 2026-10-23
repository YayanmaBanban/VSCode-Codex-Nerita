<!-- Codex 固有の保存キーを編集し、下書きを失敗応答から分離する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import {
		agentEditSchema,
		type AgentEdit,
	} from "@nerita/shared/agentManager/config";
	import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
	import AgentSettings from "../agentManager/AgentSettings.svelte";
	import AgentModelControl from "../agentManager/AgentModelControl.svelte";
	import { useAgentEditor } from "../agentManager/useAgentEditor.svelte";
	import type { AgentManagerProps } from "../agentManager/managerProps";

	let {
		agent,
		...props
	}: AgentManagerProps & { agent?: ManagedAgent | undefined } = $props();
	const editor = useAgentEditor(
		() => props,
		untrack(() => agent),
		"codex",
		() => codexDraft(agent?.edit),
	);
	/** TOML にない設定だけを補い、保存時は表示した値を明示する。 */
	function codexDraft(
		edit: AgentEdit = {
			definition: { name: "", description: "", prompt: "" },
		},
	): AgentEdit {
		return {
			...edit,
			model: edit.model ?? "gpt-6.1-sol",
			reasoningEffort: edit.reasoningEffort ?? "medium",
		};
	}
</script>

<AgentSettings {...editor.settings}>
	{#snippet children({ error })}
		<AgentModelControl
			{error}
			allowUnspecified={false}
			models={editor.models}
			model={editor.edit.model}
			effort={editor.edit.reasoningEffort}
			disabled={props.busy || agent?.editable === false}
			onChange={(
				key: "model" | "reasoning_effort",
				value: string | undefined,
			) =>
				editor.change(
					key === "model"
						? { ...editor.edit, model: value }
						: {
								...editor.edit,
								reasoningEffort:
									agentEditSchema.shape.reasoningEffort.parse(
										value,
									),
							},
				)}
		/>
		<p class="m-0 text-xs text-muted">
			権限と承認設定は親セッションから引き継ぎます。
		</p>
	{/snippet}
</AgentSettings>
