<!-- パスルールを一覧表示し、追加と各項目の編集を親の設定へ反映する。 -->
<script lang="ts">
	import {
		buttonStyle,
		type PathRuleGroupProps,
	} from "./GuardrailsRulesParts";

	import PathRuleCard from "./PathRuleCard.svelte";
	import PathRuleExceptions from "./PathRuleExceptions.svelte";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";

	let props: PathRuleGroupProps = $props();
	let {
		onChange,
		config,
		nextId,
		selection,
		locked,
		exceptionsOnly = false,
	} = $derived(props);
	let holding = $state(false);
	let index = $derived(Math.min(selection.path, config.pathRules.length - 1));
	let rule = $derived(config.pathRules[index]);
</script>

<section
	class="flex min-w-0 flex-col gap-3"
	aria-label={exceptionsOnly ? "例外" : "パスルール"}
>
	{#if !exceptionsOnly}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<button
				class={buttonStyle}
				onclick={() => {
					selection.path = config.pathRules.length;
					onChange({
						...config,
						pathRules: [
							...config.pathRules,
							{
								id: nextId("path"),
								match: "glob",
								pattern: ".env*",
								exceptions: [".env.example"],
								operations: ["read", "write"],
								action: "deny",
								reason: "秘密値を含む可能性があります。",
							},
						],
					});
				}}
			>
				＋ ルールを追加
			</button>
		</div>
	{/if}
	{#if rule}
		<div class="flex min-w-0 items-end gap-2">
			<div class="min-w-0 flex-1">
				<GuardrailsSelect
					label="パスルールを選択"
					value={String(index)}
					options={config.pathRules.map((item, position) => ({
						value: String(position),
						name: item.id,
					}))}
					onChange={(value) => (selection.path = Number(value))}
				/>
			</div>
			{#if !exceptionsOnly}
				{#key rule}
					<Tooltip
						content="長押しでパスルールを削除"
						disabled={holding}
					>
						{#snippet children({ props: triggerProps })}
							<HoldToDeleteButton
								size="field"
								label={`パスルール ${index + 1}を削除`}
								disabled={locked}
								bind:holding
								{triggerProps}
								onDelete={() =>
									onChange({
										...config,
										pathRules: config.pathRules.filter(
											(_, i) => i !== index,
										),
									})}
							/>
						{/snippet}
					</Tooltip>
				{/key}
			{/if}
		</div>
	{/if}
	<div class="guardrails-rule-selection">
		<div class="guardrails-rule-list" aria-label="パスルール一覧">
			{#each config.pathRules as item, position (position)}
				<button
					type="button"
					class="text-primary-text"
					aria-pressed={index === position}
					onclick={() => (selection.path = position)}
					><span class="break-all">{item.id}</span><span
						class="text-[12px] break-words text-muted"
						>{item.reason !== "" ? item.reason : item.pattern}</span
					></button
				>
			{/each}
		</div>
		{#if rule}
			{#if exceptionsOnly}
				<div class="min-w-0">
					<PathRuleExceptions
						{...{ index, rule, updatePath: props.updatePath }}
					/>
				</div>
			{:else}
				<PathRuleCard {...{ ...props, index, rule }} />
			{/if}
		{:else}
			<p class="text-muted">
				{exceptionsOnly
					? "パスルールタブでルールを追加してください。"
					: "ルールがありません。ルールを追加してください。"}
			</p>
		{/if}
	</div>
</section>
