<!-- パスルールの例外一覧を表示し、例外の追加・更新・削除を親へ伝える。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Plus from "@lucide/svelte/icons/plus";
	import {
		buttonStyle,
		type PathRuleExceptionsProps,
	} from "./GuardrailsRulesParts";

	import PathRuleException from "./PathRuleException.svelte";

	let props: PathRuleExceptionsProps = $props();
	let { rule, updatePath, index } = $derived(props);
</script>

<section class="flex min-w-0 flex-col gap-3" aria-label="例外の編集">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 class="m-0 text-[14px] font-semibold">
			例外 ({rule.exceptions.length})
		</h3>
		<button
			class={cn(buttonStyle, "inline-flex items-center gap-1.5")}
			onclick={() =>
				updatePath(index, {
					exceptions: [...rule.exceptions, ""],
				})}
			><Plus size={16} aria-hidden="true" />例外の追加
		</button>
	</div>
	{#each rule.exceptions as exception, entry (entry)}
		{#key entry}
			<PathRuleException {...{ entry, exception, ...props }} />
		{/key}
	{/each}
</section>
