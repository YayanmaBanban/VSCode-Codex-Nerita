<script lang="ts">
	// コマンドに含まれる文字列の条件を入力し、対象ルールの更新を親へ伝える。

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
