<!-- 広い画面と狭い画面で、同じパスルール編集欄と未選択時の案内を表示する。 -->
<script lang="ts">
	import {
		buttonStyle,
		type PathRuleCardProps,
	} from "./GuardrailsRulesParts";
	import PathRuleCard from "./PathRuleCard.svelte";
	import PathRuleExceptions from "./PathRuleExceptions.svelte";

	/** ルールが存在しない場合も、編集領域に追加方法の案内を残す。 */
	type Props = Omit<PathRuleCardProps, "rule"> & {
		rule: PathRuleCardProps["rule"] | undefined;
		exceptionsOnly?: boolean;
		onAdd?: () => void;
		locked?: boolean;
	};
	let props: Props = $props();
	let {
		rule,
		exceptionsOnly = false,
		onAdd,
		locked = false,
	} = $derived(props);
</script>

<div class="flex min-w-0 flex-col gap-3">
	{#if !exceptionsOnly && onAdd !== undefined}
		<button
			class={[buttonStyle, "self-start"]}
			onclick={onAdd}
			disabled={locked}
		>
			＋ ルールを追加
		</button>
	{/if}
	{#if rule}
		{#if exceptionsOnly}
			<PathRuleExceptions
				index={props.index}
				{rule}
				updatePath={props.updatePath}
			/>
		{:else}
			<PathRuleCard {...{ ...props, rule }} />
		{/if}
	{:else}
		<p class="text-muted">
			{exceptionsOnly
				? "パスルールタブでルールを追加してください。"
				: "ルールがありません。ルールを追加してください。"}
		</p>
	{/if}
</div>
