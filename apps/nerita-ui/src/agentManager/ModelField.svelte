<!-- モデル一覧と保存済み値を表示し、未指定は undefined として返す。 -->
<script lang="ts">
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import Field from "./Field.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";

	let {
		value,
		models,
		onChange,
	}: {
		value?: string | undefined;
		models: ManagerModel[];
		onChange: (value: string | undefined) => void;
	} = $props();
	const options = $derived([
		{ value: "", name: "未指定（バックエンドに任せる）" },
		...models,
		...(isNonEmptyString(value) &&
		!models.some((model) => model.value === value)
			? [{ value, name: `${value}（一覧にないモデル）` }]
			: []),
	]);
</script>

<Field label="モデル">
	<ConfigControl
		appearance="field"
		disabled={false}
		option={{
			id: "model",
			name: "モデル",
			currentValue: value ?? "",
			options,
		}}
		onChange={(next: string) => onChange(nonEmptyString(next) ?? undefined)}
	/>
</Field>
