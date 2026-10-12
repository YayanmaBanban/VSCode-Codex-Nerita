<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { guardActionSchema } from "@nerita/shared/guardrails/config";

	import { inputStyle, type ActionProps } from "./GuardrailsRulesParts";

	let { label, className, value, onChange }: ActionProps = $props();
</script>

<label class={className}
	>{label}<select
		class={inputStyle}
		{value}
		onchange={(event) =>
			onChange(guardActionSchema.parse(event.currentTarget.value))}
		><option value="deny">deny · 拒否</option><option value="ask"
			>ask · 承認</option
		><option value="allow">allow · 許可候補</option></select
	></label
>
