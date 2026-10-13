<script lang="ts">
	// パスルールの例外一覧を表示し、例外の追加・更新・削除を親へ伝える。

	import { cn } from "cnfast";
	import {
		buttonStyle,
		type PathRuleExceptionsProps,
	} from "./GuardrailsRulesParts";

	import PathRuleException from "./PathRuleException.svelte";
	let props: PathRuleExceptionsProps = $props();
	let { rule, updatePath, index } = $derived(props);
</script>

<div class={cn("flex flex-col gap-2", "sm:col-span-2")}>
	{#each rule.exceptions as exception, entry (entry)}
		{#key entry}
			<PathRuleException {...{ entry, exception, ...props }} />
		{/key}
	{/each}<button
		class={cn(buttonStyle, "self-start")}
		onclick={() =>
			updatePath(index, {
				exceptions: [...rule.exceptions, ""],
			})}
		>例外を追加
	</button>
</div>
