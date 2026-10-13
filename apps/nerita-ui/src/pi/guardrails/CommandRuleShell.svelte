<script lang="ts">
	// コマンドルールの対象シェルを選び、検証した選択値を親へ返す。

	import { commandRuleSchema } from "@nerita/shared/guardrails/config";

	import {
		inputStyle,
		type CommandRuleShellProps,
	} from "./GuardrailsRulesParts";

	let { rule, update }: CommandRuleShellProps = $props();
</script>

<label
	>Shell
	<select
		class={inputStyle}
		value={rule.shell}
		onchange={(event) =>
			update({
				shell: commandRuleSchema.shape.shell.parse(
					event.currentTarget.value,
				),
			})}
		>{#each ["any", "powershell", "pwsh", "bash"] as value (value)}
			<option>{value}</option>
		{/each}</select
	></label
>
