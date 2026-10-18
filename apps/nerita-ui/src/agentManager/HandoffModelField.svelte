<!-- 利用可能な固定モデルを表示し、一覧にない保存済みの値も変更するまで保持する。 -->
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
		><ModelOptions {value} {models} /></select
	></Field
>
