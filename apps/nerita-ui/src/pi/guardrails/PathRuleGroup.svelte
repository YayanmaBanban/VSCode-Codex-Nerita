<!-- パスルールの検索・選択・削除を共通サイドバーに任せ、追加と編集を設定へ反映する。 -->
<script lang="ts">
	import {
		buttonStyle,
		type PathRuleGroupProps,
	} from "./GuardrailsRulesParts";
	import PathRuleDetails from "./PathRuleDetails.svelte";
	import SearchableSelectionListSidebar from "../../ui/SearchableSelectionListSidebar.svelte";
	import { MediaQuery } from "svelte/reactivity";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";

	const wide = new MediaQuery("(min-width: 1000px)");
	let holding = $state(false);
	let props: PathRuleGroupProps = $props();
	let {
		onChange,
		config,
		nextId,
		selection,
		locked,
		exceptionsOnly = false,
	} = $derived(props);
	let index = $derived(Math.min(selection.path, config.pathRules.length - 1));
	let rule = $derived(config.pathRules[index]);
	/** 前方の項目を削除しても、編集中のルールの選択位置を維持する。 */
	function deleteRule(value: string) {
		const position = Number(value);
		selection.path = Math.max(0, index - (position < index ? 1 : 0));
		onChange({
			...config,
			pathRules: config.pathRules.filter((_, i) => i !== position),
		});
	}
	/** 新しいルールを選択してから文書へ追加し、保存前もその項目を編集できるようにする。 */
	function addRule() {
		selection.path = config.pathRules.length;
		onChange({
			...config,
			pathRules: [
				...config.pathRules,
				{
					id: nextId("path"),
					match: "glob",
					pattern: ".env*",
					directory: ".",
					exceptions: [".env.example"],
					operations: ["read", "write"],
					action: "deny",
					reason: "秘密値を含む可能性があります。",
				},
			],
		});
	}
</script>

<section
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
	aria-label={exceptionsOnly ? "例外" : "パスルール"}
	style:--sidebar-expanded-width="190px"
	style:--sidebar-panel-height="100%"
	style:--sidebar-panel-padding="12px"
	style:--sidebar-content-padding="12px"
	style:--sidebar-content-overflow="auto"
	style:--sidebar-gap="0"
>
	{#if !wide.current && !exceptionsOnly}
		<button
			class={[buttonStyle, "self-start"]}
			onclick={addRule}
			disabled={locked}
		>
			＋ ルールを追加
		</button>
	{/if}
	{#if wide.current}
		<SearchableSelectionListSidebar
			label="パスルール"
			items={config.pathRules.map((item, position) => ({
				id: String(position),
				name: item.id,
				description:
					item.reason !== ""
						? item.reason
						: `${item.pattern} ${item.directory}`,
				key: item,
			}))}
			selected={String(index)}
			disabled={locked}
			onSelect={(value: string) => (selection.path = Number(value))}
			showDelete={!exceptionsOnly}
			onDelete={deleteRule}
			deleteLabel={(item: { id: string }) =>
				`パスルール ${Number(item.id) + 1}を削除`}
			deleteTooltip="長押しでパスルールを削除"
		>
			<PathRuleDetails {...{ ...props, index, rule }} onAdd={addRule} />
		</SearchableSelectionListSidebar>
	{:else}
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
									onDelete={() => deleteRule(String(index))}
								/>
							{/snippet}
						</Tooltip>
					{/key}
				{/if}
			</div>
		{/if}
		<PathRuleDetails {...{ ...props, index, rule }} />
	{/if}
</section>
