<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type PathRuleOperationsProps } from "./GuardrailsRulesParts";

	let { rule, updatePath, index }: PathRuleOperationsProps = $props();
</script>

<div class="flex flex-wrap gap-3">
	{#each ["read", "write"] as const as operation (operation)}
		<label class="flex items-center gap-1"
			><input
				type="checkbox"
				checked={rule.operations.includes(operation)}
				oninput={(event) =>
					updatePath(index, {
						operations: event.currentTarget.checked
							? [...rule.operations, operation]
							: rule.operations.filter(
									(value) => value !== operation,
								),
					})}
			/>{operation}</label
		>
	{/each}
</div>
