<script lang="ts">
	// パスルールを一覧表示し、追加と各項目の編集を親の設定へ反映する。

	import {
		buttonStyle,
		type PathRuleGroupProps,
	} from "./GuardrailsRulesParts";

	import PathRuleCard from "./PathRuleCard.svelte";

	let props: PathRuleGroupProps = $props();
	let { onChange, config, nextId } = $derived(props);
</script>

<details open class="guardrails-rule-group">
	<summary>パスのルール</summary>
	<div class="guardrails-rule-content">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<button
				class={buttonStyle}
				onclick={() =>
					onChange({
						...config,
						pathRules: [
							...config.pathRules,
							{
								id: nextId("path"),
								base: "workspace",
								match: "glob",
								pattern: ".env*",
								exceptions: [".env.example"],
								operations: ["read", "write"],
								action: "deny",
								reason: "秘密値を含む可能性があります。",
							},
						],
					})}
				>パスを追加
			</button>
		</div>
		{#each config.pathRules as rule, index (index)}
			{#key index}
				<PathRuleCard {...{ index, rule, ...props }} />
			{/key}
		{/each}
	</div>
</details>
