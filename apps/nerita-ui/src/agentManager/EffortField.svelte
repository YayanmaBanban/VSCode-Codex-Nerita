<!-- バックエンド固有の推論候補を表示し、保存済みの非対応値を維持する。 -->
<script lang="ts">
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import Field from "./Field.svelte";
	import { inputStyle } from "./managerFields";

	let {
		label,
		value,
		options,
		onChange,
	}: {
		label: string;
		value?: string | undefined;
		options: readonly string[];
		onChange: (value: string | undefined) => void;
	} = $props();
</script>

<Field {label}
	><select
		aria-label={label}
		class={inputStyle}
		value={value ?? ""}
		onchange={(event) =>
			onChange(nonEmptyString(event.currentTarget.value) ?? undefined)}
		><option value="">未指定</option
		>{#if isNonEmptyString(value) && !options.includes(value)}<option
				{value}
				disabled>{value}（非対応・未確認）</option
			>{/if}{#each options as option (option)}<option value={option}
				>{option}</option
			>{/each}</select
	>{#if options.length === 0}<span
			class="text-xs leading-relaxed text-warning"
			>選択できる推論レベルを確認できません。モデルの指定を確認し、一覧を再読み込みしてください。</span
		>{/if}</Field
>
