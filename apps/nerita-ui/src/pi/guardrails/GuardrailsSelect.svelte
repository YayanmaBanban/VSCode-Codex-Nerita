<!-- ガードレールの選択項目を共通の設定メニューに渡し、見出しと選択値を揃える。 -->
<script lang="ts">
	import type { ConfigChoice } from "@nerita/shared/composer";
	import ConfigControl from "../../chat/composer/ConfigControl.svelte";

	let {
		label,
		value,
		options,
		onChange,
		disabled = false,
	}: {
		label: string;
		value: string;
		options: ConfigChoice[];
		onChange: (value: string) => void;
		disabled?: boolean;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-1">
	<span>{label}</span>
	<ConfigControl
		appearance="field"
		{disabled}
		{onChange}
		option={{ id: label, name: label, currentValue: value, options }}
	/>
</div>
