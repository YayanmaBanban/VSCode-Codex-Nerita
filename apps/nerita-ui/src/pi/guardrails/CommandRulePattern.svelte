<!-- コマンドに含まれる文字列の条件を入力し、対象ルールの更新を親へ伝える。 -->
<script lang="ts">
	import { cn } from "cnfast";
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

<label class="flex min-w-0 flex-col gap-1"
	>含まれる文字列
	<input
		class={cn(inputStyle, "h-[38px]")}
		value={rule.pattern}
		oninput={(event) =>
			update({
				pattern: event.currentTarget.value,
			})}
	/></label
>
