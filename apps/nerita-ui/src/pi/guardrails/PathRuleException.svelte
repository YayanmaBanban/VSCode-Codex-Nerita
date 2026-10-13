<script lang="ts">
	// パスルール内の例外を編集し、その例外の更新・削除を親へ伝える。

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
