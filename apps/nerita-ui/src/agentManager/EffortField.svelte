<!-- バックエンド固有の推論候補を表示し、保存済みの非対応値を維持する。 -->
<script lang="ts">
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import Field from "./Field.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import { reasoningLabel } from "@nerita/shared/settingsCards";

	let {
		label,
		value,
		options,
		onChange,
		emptyMessage = "選択できる推論レベルを確認できません。モデルの指定を確認し、一覧を再読み込みしてください。",
	}: {
		label: string;
		value?: string | undefined;
		options: readonly string[];
		onChange: (value: string | undefined) => void;
		emptyMessage?: string | undefined;
	} = $props();
	let unsupported = $derived(
		isNonEmptyString(value) && !options.includes(value),
	);
	let choices = $derived([
		{ value: "", name: "未指定" },
		...(unsupported && value !== undefined
			? [{ value, name: `${reasoningLabel(value)}（非対応・未確認）` }]
			: []),
		...options.map((option) => ({
			value: option,
			name: reasoningLabel(option),
		})),
	]);
</script>

<Field {label}>
	<ConfigControl
		appearance="field"
		option={{
			id: "handoff-effort",
			name: label,
			currentValue: value ?? "",
			options: choices,
		}}
		disabled={false}
		disabledValues={unsupported && value !== undefined ? [value] : []}
		onChange={(selected: string) =>
			onChange(nonEmptyString(selected) ?? undefined)}
	/>
	{#if options.length === 0}
		<span class="text-xs leading-relaxed text-warning">{emptyMessage}</span>
	{/if}
</Field>
