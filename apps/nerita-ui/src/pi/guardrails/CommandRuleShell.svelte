<!-- コマンドルールの対象シェルを選び、検証した選択値を親へ返す。 -->
<script lang="ts">
	import { commandRuleSchema } from "@nerita/shared/guardrails/config";

	import { type CommandRuleShellProps } from "./GuardrailsRulesParts";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";

	let { rule, update }: CommandRuleShellProps = $props();
</script>

<GuardrailsSelect
	label="Shell"
	value={rule.shell}
	options={["any", "powershell", "pwsh", "bash"].map((value) => ({
		value,
		name: value,
	}))}
	onChange={(value) =>
		update({ shell: commandRuleSchema.shape.shell.parse(value) })}
/>
