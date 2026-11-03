<!-- コマンドルールを一覧表示し、追加・個別編集の結果を設定全体へ反映する。 -->
<script lang="ts">
	import {
		buttonStyle,
		type CommandRuleGroupProps,
	} from "./GuardrailsRulesParts";

	import CommandRuleDetails from "./CommandRuleDetails.svelte";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";
	import SearchableSelectionListSidebar from "../../ui/SearchableSelectionListSidebar.svelte";
	import { MediaQuery } from "svelte/reactivity";

	let {
		onChange,
		config,
		nextId,
		selection,
		locked,
		onSelect,
	}: CommandRuleGroupProps = $props();
	const wide = new MediaQuery("(min-width: 1000px)");
	let selectedIndex = $derived(
		Math.min(selection.command, config.commandRules.length - 1),
	);
	let currentRule = $derived(config.commandRules[selectedIndex]);
	let holding = $state(false);
	/** 前方のルールを削除しても、編集中のルールを選択したままにする。 */
	function deleteRule(value: string) {
		const position = Number(value);
		onSelect(
			Math.max(0, selectedIndex - (position < selectedIndex ? 1 : 0)),
		);
		onChange({
			...config,
			commandRules: config.commandRules.filter(
				(_, index) => index !== position,
			),
		});
	}
	/** 新しいルールを選択し、他の条件を保持して文書に追加する。 */
	function addRule() {
		onSelect(config.commandRules.length);
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
	}
	/** 選択中のルールだけを更新し、一覧内の他の条件を保持する。 */
	function update(
		patch: Partial<CommandRuleGroupProps["config"]["commandRules"][number]>,
	) {
		onChange({
			...config,
			commandRules: config.commandRules.map((item, index) =>
				index === selectedIndex ? { ...item, ...patch } : item,
			),
		});
	}
</script>

<section
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
	aria-label="コマンドルール"
	style:--sidebar-expanded-width="190px"
	style:--sidebar-panel-height="100%"
	style:--sidebar-panel-padding="12px"
	style:--sidebar-content-padding="12px"
	style:--sidebar-content-overflow="auto"
	style:--sidebar-gap="0"
>
	{#if wide.current}
		<SearchableSelectionListSidebar
			label="コマンドルール"
			items={config.commandRules.map((item, position) => ({
				id: String(position),
				name: item.id,
				description: item.reason !== "" ? item.reason : item.pattern,
				key: item,
			}))}
			selected={String(selectedIndex)}
			disabled={locked}
			onSelect={(value) => onSelect(Number(value))}
			showDelete
			onDelete={deleteRule}
			deleteLabel={(item: { id: string }) =>
				`コマンドルール ${Number(item.id) + 1}を削除`}
			deleteTooltip="長押しでコマンドルールを削除"
		>
			<CommandRuleDetails
				rule={currentRule}
				{update}
				{locked}
				onAdd={addRule}
			/>
		</SearchableSelectionListSidebar>
	{:else}
		<button
			class={[buttonStyle, "self-start"]}
			disabled={locked}
			onclick={addRule}
		>
			＋ ルールを追加
		</button>
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
						onChange={(value) => onSelect(Number(value))}
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
									deleteRule(String(selectedIndex))}
							/>
						{/snippet}
					</Tooltip>
				{/key}
			</div>
		{/if}
		<CommandRuleDetails rule={currentRule} {update} {locked} />
	{/if}
</section>
