<!-- 定義を持つプロジェクトのエージェントだけ、本文とメタデータを編集する。 -->
<script lang="ts">
	import type { AgentEdit } from "@nerita/shared/agentManager/config";
	import { cn } from "cnfast";
	import Field from "./Field.svelte";
	import { inputStyle } from "./managerFields";
	import FieldErrorTooltip from "../ui/FieldErrorTooltip.svelte";

	let {
		edit,
		onChange,
		field,
		label,
		placeholder,
		rows,
		limit,
		error,
	}: {
		edit: AgentEdit;
		onChange: (edit: AgentEdit) => void;
		field: "name" | "description" | "prompt";
		label: string;
		placeholder?: string;
		rows?: number;
		limit: number;
		error?: string | undefined;
	} = $props();
	let definition = $derived(edit.definition);
	/** 編集対象の定義がある場合だけ、指定された項目を更新して親へ伝える。 */
	function update(value: string) {
		if (definition) {
			onChange({
				...edit,
				definition: { ...definition, [field]: value },
			});
		}
	}
</script>

{#if definition}
	<FieldErrorTooltip message={error}>
		{#snippet children({ props })}
			<Field {label}>
				{#if rows}
					<textarea
						class={cn(inputStyle, "resize-none")}
						{...props}
						{rows}
						{placeholder}
						maxlength={limit}
						value={definition[field]}
						oninput={(event) => update(event.currentTarget.value)}
					></textarea>
				{:else}
					<input
						class={inputStyle}
						{...props}
						required
						{placeholder}
						maxlength={limit}
						value={definition[field]}
						oninput={(event) => update(event.currentTarget.value)}
					/>
				{/if}
			</Field>
		{/snippet}
	</FieldErrorTooltip>
{/if}
