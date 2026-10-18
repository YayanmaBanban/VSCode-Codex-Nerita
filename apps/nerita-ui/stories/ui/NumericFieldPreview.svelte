<!-- 共通数値入力の下書きだけを保持し、操作と表示は製品コンポーネントで確認する。 -->
<script lang="ts">
	import { untrack, type ComponentProps } from "svelte";
	import NumericField from "../../src/ui/NumericField.svelte";

	let {
		initial = 120,
		...input
	}: Omit<ComponentProps<typeof NumericField>, "value" | "onChange"> & {
		initial?: number;
	} = $props();
	let value = $state<number | undefined>(untrack(() => initial));
</script>

<div class="mx-auto max-w-lg p-6 text-foreground">
	<NumericField
		{...input}
		{value}
		onChange={(next: number | undefined) => {
			value = next;
		}}
	/>
</div>
