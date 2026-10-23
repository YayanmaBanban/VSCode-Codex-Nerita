<!-- 利用可能な固定モデルを表示し、一覧にない保存済みの値も変更するまで保持する。 -->
<script lang="ts">
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";
	import Field from "./Field.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";

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
	let choices = $derived([
		...(value !== "" && !models.some((model) => model.value === value)
			? [{ value, name: `${value}（保存済み・未確認）` }]
			: []),
		...models.map((model) => ({ value: model.value, name: model.name })),
	]);
</script>

<Field {label}
	><ConfigControl
		appearance="field"
		option={{
			id: "handoff-model",
			name: label,
			currentValue: value,
			options: choices,
		}}
		disabled={false}
		{onChange}
	/></Field
>
