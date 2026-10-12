<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import {
		inputStyle,
		buttonStyle,
		type PathRuleExceptionProps,
	} from "./GuardrailsRulesParts";

	let { entry, exception, updatePath, index, rule }: PathRuleExceptionProps =
		$props();
</script>

<div class="flex items-end gap-2">
	<label class="min-w-0 flex-1"
		>例外 {entry + 1}<input
			class={inputStyle}
			value={exception}
			oninput={(event) =>
				updatePath(index, {
					exceptions: rule.exceptions.map((value, i) =>
						i === entry ? event.currentTarget.value : value,
					),
				})}
		/></label
	><button
		class={buttonStyle}
		onclick={() =>
			updatePath(index, {
				exceptions: rule.exceptions.filter((_, i) => i !== entry),
			})}
		>例外 {entry + 1}を削除
	</button>
</div>
