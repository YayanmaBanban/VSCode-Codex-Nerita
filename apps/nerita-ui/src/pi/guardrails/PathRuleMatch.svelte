<!-- パスの照合方式を選び、検証した選択値を親へ返す。 -->
<script lang="ts">
	import { pathRuleSchema } from "@nerita/shared/guardrails/config";

	import { type PathRuleMatchProps } from "./GuardrailsRulesParts";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";

	let { rule, updatePath, index }: PathRuleMatchProps = $props();
</script>

<GuardrailsSelect
	label="照合"
	value={rule.match}
	options={[
		{
			value: "glob",
			name: "Glob",
			description:
				"* は同じ階層、** は複数階層、? は区切り以外の1文字に一致します。",
		},
		{ value: "directory", name: "ディレクトリ配下" },
	]}
	onChange={(value) =>
		updatePath(index, { match: pathRuleSchema.shape.match.parse(value) })}
/>
