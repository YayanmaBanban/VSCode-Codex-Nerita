<!-- コマンドルールを一覧表示し、追加・個別編集の結果を設定全体へ反映する。 -->
<script lang="ts">
	import {
		buttonStyle,
		type CommandRuleGroupProps,
	} from "./GuardrailsRulesParts";

	import CommandRuleCard from "./CommandRuleCard.svelte";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";

	let { onChange, config, nextId, selection, locked }: CommandRuleGroupProps =
		$props();
	let selectedIndex = $derived(
		Math.min(selection.command, config.commandRules.length - 1),
	);
	let currentRule = $derived(config.commandRules[selectedIndex]);
	let holding = $state(false);
</script>

<section class="flex min-w-0 flex-col gap-3" aria-label="コマンドルール">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<button
			class={buttonStyle}
			onclick={() => {
				selection.command = config.commandRules.length;
				onChange({
					...config,
					commandRules: [
						...config.commandRules,
						{
							id: nextId("command"),
							shell: "any",
							match: "contains",
							pattern: "git reset --hard",
							action: "deny",
							reason: "追跡対象ファイルの変更を破棄します。",
						},
					],
				});
			}}
			>＋ ルールを追加
		</button>
	</div>
	{#if currentRule}
		<div class="flex min-w-0 items-end gap-2">
			<div class="min-w-0 flex-1">
				<GuardrailsSelect
					label="コマンドルールを選択"
					value={String(selectedIndex)}
					options={config.commandRules.map((item, position) => ({
						value: String(position),
						name: item.id,
					}))}
					onChange={(value) => (selection.command = Number(value))}
				/>
			</div>
			{#key currentRule}
				<Tooltip
					content="長押しでコマンドルールを削除"
					disabled={holding}
				>
					{#snippet children({ props: triggerProps })}
						<HoldToDeleteButton
							size="field"
							label={`コマンドルール ${selectedIndex + 1}を削除`}
							disabled={locked}
							bind:holding
							{triggerProps}
							onDelete={() =>
								onChange({
									...config,
									commandRules: config.commandRules.filter(
										(_, i) => i !== selectedIndex,
									),
								})}
						/>
					{/snippet}
				</Tooltip>
			{/key}
		</div>
	{/if}
	<div class="guardrails-rule-selection">
		<div class="guardrails-rule-list" aria-label="コマンドルール一覧">
			{#each config.commandRules as item, position (position)}
				<button
					type="button"
					class="text-primary-text"
					aria-pressed={selectedIndex === position}
					onclick={() => (selection.command = position)}
					><span class="break-all">{item.id}</span><span
						class="text-[12px] break-words text-muted"
						>{item.reason !== "" ? item.reason : item.pattern}</span
					></button
				>
			{/each}
		</div>
		{#each config.commandRules as rule, index (index)}
			{#if index === selectedIndex}
				<!-- 対象のコマンドルールだけを更新し、他のルールを保った設定を親へ返す。 -->
				{@const update = (patch: Partial<typeof rule>) =>
					onChange({
						...config,
						commandRules: config.commandRules.map((item, i) =>
							i === index ? { ...item, ...patch } : item,
						),
					})}
				<CommandRuleCard {rule} {update} />
			{/if}
		{/each}
		{#if config.commandRules.length === 0}
			<p class="text-muted">
				ルールがありません。ルールを追加してください。
			</p>
		{/if}
	</div>
</section>
