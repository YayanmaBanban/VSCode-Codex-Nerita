<!-- コマンドルールの条件・判定・理由を編集し、項目の更新を親へ伝える。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		inputStyle,
		type CommandRuleCardProps,
	} from "./GuardrailsRulesParts";
	import Action from "./Action.svelte";

	import CommandRulePattern from "./CommandRulePattern.svelte";
	import CommandRuleShell from "./CommandRuleShell.svelte";

	let { rule, update }: CommandRuleCardProps = $props();
</script>

<section
	class={cn(
		"guardrails-rule-card m-0 min-w-0 shrink-0 rounded border",
		"border-panel-border",
	)}
>
	<div class="p-3">
		<div class={cn("grid grid-cols-1 gap-3", "sm:grid-cols-2")}>
			<label class="flex min-w-0 flex-col gap-1"
				>ID
				<input
					class={cn(inputStyle, "h-[38px]")}
					value={rule.id}
					oninput={(event) =>
						update({
							id: event.currentTarget.value,
						})}
				/></label
			>
			<Action
				{...{
					label: "判定",
					value: rule.action,
					onChange: (action: "allow" | "ask" | "deny") =>
						update({ action }),
				}}
			/>
			<CommandRuleShell
				{...{
					rule,
					update,
				}}
			/>
			<CommandRulePattern {...{ rule, update }} />
			<label class="sm:col-span-2"
				>理由
				<textarea
					rows={4}
					maxlength={500}
					class={cn(inputStyle, "h-[96px] resize-none")}
					value={rule.reason}
					oninput={(event) =>
						update({
							reason: event.currentTarget.value,
						})}></textarea></label
			>
		</div>
	</div>
</section>
