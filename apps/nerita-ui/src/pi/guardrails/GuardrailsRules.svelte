<!-- パスとコマンドのルールをフォームで編集し、識別子の重複を避けて設定全体へ反映する。 -->
<script lang="ts">
	import { type PathRule } from "@nerita/shared/guardrails/config";
	import type { BuiltinRules } from "@nerita/shared/guardrails/builtins";

	let {
		config,
		onChange,
		section,
		selection,
		locked,
		onEditExceptions,
	}: GuardrailsRulesProps = $props();

	/** パスとコマンドの両ルールに重複しない ID を採番する。 */
	const nextId = (prefix: string) => {
		const ids = new Set(
			[...config.pathRules, ...config.commandRules].map(
				(rule) => rule.id,
			),
		);
		let count = 1;
		while (ids.has(`${prefix}-${count}`)) {
			count++;
		}
		return `${prefix}-${count}`;
	};

	import { type GuardrailsRulesProps } from "./GuardrailsRulesParts";
	import Action from "./Action.svelte";
	import CommandRuleGroup from "./CommandRuleGroup.svelte";
	import PathRuleGroup from "./PathRuleGroup.svelte";
	import GuardrailsBuiltins from "./GuardrailsBuiltins.svelte";

	/** 指定したパスルールだけを更新し、他のルールを保持した設定を親へ返す。 */
	const updatePath = (index: number, patch: Partial<PathRule>) =>
		onChange({
			...config,
			pathRules: config.pathRules.map((rule, i) =>
				i === index ? { ...rule, ...patch } : rule,
			),
		});
</script>

<div class="flex flex-col gap-5">
	{#if section === "overview"}
		<Action
			{...{
				label: "ワークスペース外の読み取り",
				className: "flex flex-col gap-2",
				value: config.pathAccess.outsideRead,
				onChange: (outsideRead: "allow" | "ask" | "deny") =>
					onChange({
						...config,
						pathAccess: { ...config.pathAccess, outsideRead },
					}),
			}}
		/>
		<p class="m-0 text-[12px] text-muted">
			ワークスペース外の書き込みは拒否します。シェル・write/edit・拡張ツールの承認は維持します。追加ルールでは組み込み保護を解除できません。
		</p>
	{:else}
		{#if section === "builtins"}
			<GuardrailsBuiltins
				value={config.builtins}
				disabled={locked}
				onChange={(builtins: BuiltinRules) =>
					onChange({ ...config, builtins })}
			/>
		{:else}
			{#if section === "path" || section === "exceptions"}
				<PathRuleGroup
					{onEditExceptions}
					{selection}
					{locked}
					exceptionsOnly={section === "exceptions"}
					{...{
						onChange,
						config,
						nextId,
						updatePath,
					}}
				/>
			{:else}
				<CommandRuleGroup
					{...{ onChange, config, nextId, selection, locked }}
				/>
			{/if}
		{/if}
	{/if}
</div>
