<!-- 固定モデルの再選択では全モデルを表示し、推論値は変更しない。 -->
<script lang="ts">
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";
	import Field from "./Field.svelte";
	import ModelOptions from "./ModelOptions.svelte";
	import { inputStyle } from "./managerFields";
	let {
		label,
		value,
		models,
		onChange,
	}: {
		label: string;
		value: string;
		models: ManagerModel[];
		onChange: (value: string) => void;
	} = $props();
</script>

<Field {label}
	><select
		aria-label={label}
		class={inputStyle}
		required
		{value}
		onchange={(event) => onChange(event.currentTarget.value)}
		><option value="">モデルを選択</option><ModelOptions
			{value}
			{models}
		/></select
	></Field
>
