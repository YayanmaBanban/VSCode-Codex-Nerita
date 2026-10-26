<!-- 許可・承認・拒否を選び、検証した判定値を親へ返す。 -->
<script lang="ts">
	import { guardActionSchema } from "@nerita/shared/guardrails/config";

	import { type ActionProps } from "./GuardrailsRulesParts";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";

	let { label, className, value, onChange }: ActionProps = $props();
</script>

<div class={className}>
	<GuardrailsSelect
		{label}
		{value}
		options={[
			{ value: "deny", name: "deny · 拒否" },
			{ value: "ask", name: "ask · 承認" },
			{ value: "allow", name: "allow · 許可候補" },
		]}
		onChange={(value) => onChange(guardActionSchema.parse(value))}
	/>
</div>
