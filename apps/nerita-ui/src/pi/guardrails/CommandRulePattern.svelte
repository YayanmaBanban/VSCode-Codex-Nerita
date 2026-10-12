<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type GuardrailsConfig } from "@nerita/shared/guardrails/config";

	import { inputStyle } from "./GuardrailsRulesParts";

	let {
		rule,
		update,
	}: {
		rule: GuardrailsConfig["commandRules"][number];
		update: (
			patch: Partial<GuardrailsConfig["commandRules"][number]>,
		) => void;
	} = $props();
</script>

<label
	>含まれる文字列
	<input
		class={inputStyle}
		value={rule.pattern}
		oninput={(event) =>
			update({
				pattern: event.currentTarget.value,
			})}
	/></label
>
