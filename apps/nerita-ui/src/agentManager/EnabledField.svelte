<!-- 有効・無効・未指定の三値を区別し、設定キーの削除を可能にする。 -->
<script lang="ts">
	import Field from "./Field.svelte";
	import { inputStyle } from "./managerFields";
	let {
		value,
		onChange,
	}: {
		value: boolean | undefined;
		onChange: (value: boolean | undefined) => void;
	} = $props();
	let selected = $derived.by(() => {
		if (value === undefined) {
			return "inherit";
		}
		return value ? "disabled" : "enabled";
	});
</script>

<Field label="有効／無効"
	><select
		class={inputStyle}
		value={selected}
		onchange={(event) =>
			onChange(
				event.currentTarget.value === "inherit"
					? undefined
					: event.currentTarget.value === "disabled",
			)}
		><option value="inherit">未指定（バックエンドに任せる）</option><option
			value="enabled">Enabled</option
		><option value="disabled">Disabled</option></select
	></Field
>
