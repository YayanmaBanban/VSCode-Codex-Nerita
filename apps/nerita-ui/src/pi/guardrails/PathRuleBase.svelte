<!-- パスルールの基準ディレクトリを選び、検証した選択値を親へ返す。 -->
<script lang="ts">
	import { pathRuleSchema } from "@nerita/shared/guardrails/config";

	import { inputStyle, type PathRuleBaseProps } from "./GuardrailsRulesParts";

	let { rule, updatePath, index }: PathRuleBaseProps = $props();
</script>

<label
	>基準
	<select
		class={inputStyle}
		value={rule.base}
		onchange={(event) =>
			updatePath(index, {
				base: pathRuleSchema.shape.base.parse(
					event.currentTarget.value,
				),
			})}
		><option value="workspace">workspace</option><option value="home"
			>home</option
		></select
	></label
>
