<!-- 幅にかかわらず同じコマンドルール編集欄と空状態を表示する。 -->
<script lang="ts">
	import CommandRuleCard from "./CommandRuleCard.svelte";
	import {
		buttonStyle,
		type CommandRuleCardProps,
	} from "./GuardrailsRulesParts";

	let {
		rule,
		update,
		onAdd,
		locked,
	}: {
		rule: CommandRuleCardProps["rule"] | undefined;
		update: CommandRuleCardProps["update"];
		onAdd?: () => void;
		locked: boolean;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-3">
	{#if onAdd !== undefined}
		<button
			class={[buttonStyle, "self-start"]}
			disabled={locked}
			onclick={onAdd}
		>
			＋ ルールを追加
		</button>
	{/if}
	{#if rule}
		<CommandRuleCard {rule} {update} />
	{:else}
		<p class="text-muted">ルールがありません。ルールを追加してください。</p>
	{/if}
</div>
