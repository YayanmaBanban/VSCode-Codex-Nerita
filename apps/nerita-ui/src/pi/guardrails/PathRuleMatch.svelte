<!-- パスの照合方式を選び、検証した選択値を親へ返す。 -->
<script lang="ts">
	import { pathRuleSchema } from "@nerita/shared/guardrails/config";

	import {
		inputStyle,
		type PathRuleMatchProps,
	} from "./GuardrailsRulesParts";

	let { rule, updatePath, index }: PathRuleMatchProps = $props();
</script>

<label
	>照合
	<select
		class={inputStyle}
		value={rule.match}
		onchange={(event) =>
			updatePath(index, {
				match: pathRuleSchema.shape.match.parse(
					event.currentTarget.value,
				),
			})}
		><option value="glob">glob</option><option value="file"
			>ファイル完全一致</option
		><option value="directory">ディレクトリ配下</option></select
	></label
>
