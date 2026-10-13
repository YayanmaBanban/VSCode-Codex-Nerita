<script lang="ts">
	// コマンドルールを一覧表示し、追加・個別編集の結果を設定全体へ反映する。

	import {
		buttonStyle,
		type CommandRuleGroupProps,
	} from "./GuardrailsRulesParts";

	import CommandRuleCard from "./CommandRuleCard.svelte";

	let { onChange, config, nextId }: CommandRuleGroupProps = $props();
</script>

<details open class="guardrails-rule-group">
	<summary>コマンドのルール</summary>
	<div class="guardrails-rule-content">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<button
				class={buttonStyle}
				onclick={() =>
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
								reason: "未保存の変更を破棄します。",
							},
						],
					})}
				>コマンドを追加
			</button>
		</div>
		{#each config.commandRules as rule, index (index)}
			{@const update = (patch: Partial<typeof rule>) =>
				onChange({
					...config,
					commandRules: config.commandRules.map((item, i) =>
						i === index ? { ...item, ...patch } : item,
					),
				})}
			{#key index}
				<CommandRuleCard
					{...{
						index,
						rule,
						update,
						onChange,
						config,
					}}
				/>
			{/key}
		{/each}
	</div>
</details>
