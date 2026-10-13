<script lang="ts">
	// パスルールを適用する読み取り・書き込み操作を選び、変更を親へ伝える。

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
