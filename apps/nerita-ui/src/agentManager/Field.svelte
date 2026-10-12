<!-- 設定入力をラベルで囲み、ラベルのクリックから入力へ移動できるようにする。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<label class="grid min-w-0 gap-2 text-sm"
	><span class="font-medium">{label}</span>{@render children()}</label
>
