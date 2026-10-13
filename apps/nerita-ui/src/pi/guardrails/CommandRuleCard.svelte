<!-- コマンドルールの条件・判定・理由を編集し、更新と削除を親へ伝える。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		inputStyle,
		buttonStyle,
		ruleBackground,
		type CommandRuleCardProps,
	} from "./GuardrailsRulesParts";
	import Action from "./Action.svelte";

	import CommandRulePattern from "./CommandRulePattern.svelte";
	import CommandRuleShell from "./CommandRuleShell.svelte";

	let { index, rule, update, onChange, config }: CommandRuleCardProps =
		$props();
</script>

<details
	open
	style:background-color={ruleBackground(index + 3)}
	class={cn(
		"guardrails-rule-card m-0 min-w-0 shrink-0 rounded border",
		"border-panel-border",
	)}
>
	<summary class="cursor-pointer p-3 text-[13px]"
		>コマンドルール {index + 1}</summary
	>
	<div class="p-3 pt-0">
		<div class={cn("grid grid-cols-1 gap-3", "sm:grid-cols-2")}>
			<label
				>ID
				<input
					class={inputStyle}
					value={rule.id}
					oninput={(event) =>
						update({
							id: event.currentTarget.value,
						})}
				/></label
			><Action
				{...{
					label: "判定",
					value: rule.action,
					onChange: (action: "allow" | "ask" | "deny") =>
						update({ action }),
				}}
			/><CommandRuleShell
				{...{
					rule,
					update,
				}}
			/><CommandRulePattern {...{ rule, update }} /><label
				class="sm:col-span-2"
				>理由
				<input
					class={inputStyle}
					value={rule.reason}
					oninput={(event) =>
						update({
							reason: event.currentTarget.value,
						})}
				/></label
			>
		</div>
		<button
			class={cn(buttonStyle, "mt-3")}
			onclick={() =>
				onChange({
					...config,
					commandRules: config.commandRules.filter(
						(_, i) => i !== index,
					),
				})}
			>コマンドルール {index + 1}を削除
		</button>
	</div>
</details>
