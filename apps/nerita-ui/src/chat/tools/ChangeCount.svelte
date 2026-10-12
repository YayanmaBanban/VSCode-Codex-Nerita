<!-- 色と記号の両方で追加行・削除行を表示する。 -->
<script lang="ts">
	let { added, removed }: { added: number; removed: number } = $props();
</script>

<span
	class="inline-flex shrink-0 gap-[8px] font-editor tabular-nums"
	aria-label={`${added} 行追加、${removed} 行削除`}
	><span class="text-menu-check">+{added}</span><span class="text-tool-error"
		>-{removed}</span
	></span
>
