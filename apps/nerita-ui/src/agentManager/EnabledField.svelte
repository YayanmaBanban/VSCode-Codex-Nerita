<!-- 有効・無効・未指定の三値を区別し、設定キーの削除を可能にする。 -->
<script lang="ts">
	import Field from "./Field.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";

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

<Field label="有効／無効">
	<ConfigControl
		appearance="field"
		option={{
			id: "agent-enabled",
			name: "有効／無効",
			currentValue: selected,
			options: [
				{ value: "inherit", name: "未指定（バックエンドに任せる）" },
				{ value: "enabled", name: "Enabled" },
				{ value: "disabled", name: "Disabled" },
			],
		}}
		disabled={false}
		onChange={(selected: string) =>
			onChange(
				selected === "inherit" ? undefined : selected === "disabled",
			)}
	/>
</Field>
