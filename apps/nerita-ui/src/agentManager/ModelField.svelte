<!-- モデル一覧と保存済み値を表示し、未指定は undefined として返す。 -->
<script lang="ts">
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import Field from "./Field.svelte";
	import ModelOptions from "./ModelOptions.svelte";
	import { inputStyle } from "./managerFields";

	let {
		value,
		models,
		onChange,
	}: {
		value?: string | undefined;
		models: ManagerModel[];
		onChange: (value: string | undefined) => void;
	} = $props();
</script>

<Field label="モデル">
	<select
		aria-label="モデル"
		class={inputStyle}
		value={value ?? ""}
		onchange={(event) =>
			onChange(nonEmptyString(event.currentTarget.value) ?? undefined)}
		><option value="">未指定（バックエンドに任せる）</option><ModelOptions
			value={value ?? ""}
			{models}
		/></select
	>
</Field>
