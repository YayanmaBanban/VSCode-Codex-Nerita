<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

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
