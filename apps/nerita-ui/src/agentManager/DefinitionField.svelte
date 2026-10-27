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
	let touched = $state(false);
	/** 新規作成では、名前欄へフォーカスを移して入力を始められるようにする。 */
	function focusNewName(node: HTMLInputElement) {
		if (field === "name" && definition?.name === "") {
			node.focus({ preventScroll: true });
		}
	}
	/** 編集対象の定義がある場合だけ、指定された項目を更新して親へ伝える。 */
	function update(value: string) {
		touched = true;
		if (definition) {
			onChange({
				...edit,
				definition: { ...definition, [field]: value },
			});
		}
	}
</script>

{#if definition}
	<FieldErrorTooltip
		message={touched || definition[field] !== "" ? error : undefined}
	>
		{#snippet children({ props })}
			<Field {label}>
				{#if rows}
					<textarea
						class={cn(inputStyle, "resize-none")}
						{...props}
						{rows}
						{placeholder}
						maxlength={limit}
						onblur={() => {
							touched = true;
						}}
						value={definition[field]}
						oninput={(event) =>
							update(event.currentTarget.value)}></textarea>
				{:else}
					<input
						{@attach focusNewName}
						class={inputStyle}
						{...props}
						required
						{placeholder}
						maxlength={limit}
						onblur={() => {
							touched = true;
						}}
						value={definition[field]}
						oninput={(event) => update(event.currentTarget.value)}
					/>
				{/if}
			</Field>
		{/snippet}
	</FieldErrorTooltip>
{/if}
