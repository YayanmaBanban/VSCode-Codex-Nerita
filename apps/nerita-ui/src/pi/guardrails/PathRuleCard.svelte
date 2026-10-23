<!-- パスルールの条件・判定・理由を編集し、更新と削除を親へ伝える。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		inputStyle,
		buttonStyle,
		ruleBackground,
		type PathRuleCardProps,
		pathRuleCardStyle,
		pathRuleFieldsStyle,
	} from "./GuardrailsRulesParts";
	import Action from "./Action.svelte";

	import PathRuleBase from "./PathRuleBase.svelte";
	import PathRuleMatch from "./PathRuleMatch.svelte";
	import PathRuleOperations from "./PathRuleOperations.svelte";
	import PathRuleExceptions from "./PathRuleExceptions.svelte";

	let props: PathRuleCardProps = $props();
	let { index, rule, updatePath, onChange, config } = $derived(props);
</script>

<details
	open
	style:background-color={ruleBackground(index)}
	class={pathRuleCardStyle}
>
	<summary class="cursor-pointer p-3 text-[13px]"
		>パスルール {index + 1}</summary
	>
	<div class="p-3 pt-0">
		<div class={pathRuleFieldsStyle}>
			<label
				>ID
				<input
					class={inputStyle}
					value={rule.id}
					oninput={(event) =>
						updatePath(index, {
							id: event.currentTarget.value,
						})}
				/></label
			>
			<Action
				{...{
					label: "判定",
					value: rule.action,
					onChange: (action: "allow" | "ask" | "deny") =>
						updatePath(index, { action }),
				}}
			/>
			<PathRuleBase {...{ ...props }} />
			<PathRuleMatch
				{...{
					...props,
				}}
			/>
			<label class="sm:col-span-2"
				>相対パス / パターン
				<input
					class={inputStyle}
					value={rule.pattern}
					oninput={(event) =>
						updatePath(index, {
							pattern: event.currentTarget.value,
						})}
				/></label
			>
			<PathRuleExceptions
				{...{
					...props,
				}}
			/>
			<PathRuleOperations {...{ ...props }} />
			<label class="sm:col-span-2"
				>理由
				<input
					class={inputStyle}
					value={rule.reason}
					oninput={(event) =>
						updatePath(index, {
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
					pathRules: config.pathRules.filter((_, i) => i !== index),
				})}
			>パスルール {index + 1}を削除
		</button>
	</div>
</details>
