<!-- パスルール内の例外を編集し、その例外の更新・削除を親へ伝える。 -->
<script lang="ts">
	import {
		inputStyle,
		type PathRuleExceptionProps,
	} from "./GuardrailsRulesParts";
	import SimpleDeleteButton from "../../ui/SimpleDeleteButton.svelte";

	let { entry, exception, updatePath, index, rule }: PathRuleExceptionProps =
		$props();
</script>

<div class="flex items-end gap-2">
	<label class="min-w-0 flex-1">
		<input
			aria-label={`例外 ${entry + 1}`}
			class={inputStyle}
			value={exception}
			oninput={(event) =>
				updatePath(index, {
					exceptions: rule.exceptions.map((value, i) =>
						i === entry ? event.currentTarget.value : value,
					),
				})}
		/>
	</label>
	<SimpleDeleteButton
		label="例外を削除"
		ariaLabel={`例外 ${entry + 1}を削除`}
		onDelete={() =>
			updatePath(index, {
				exceptions: rule.exceptions.filter((_, i) => i !== entry),
			})}
	/>
</div>
