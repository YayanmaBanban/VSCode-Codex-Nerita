<script lang="ts">
	import { type PathRule } from "@nerita/shared/guardrails/config";

	let { config, onChange }: GuardrailsRulesProps = $props();

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

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const updatePath = (index: number, patch: Partial<PathRule>) =>
		onChange({
			...config,
			pathRules: config.pathRules.map((rule, i) =>
				i === index ? { ...rule, ...patch } : rule,
			),
		});
</script>

<div class="flex flex-col gap-5">
	<Action
		{...{
			label: "workspace外の読取り",
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
		workspace外の書込みは拒否します。Shell・write/edit・拡張Toolの承認は維持します。SSHなどの組込み保護は緩和できません。
	</p>
	<PathRuleGroup
		{...{
			onChange,
			config,
			nextId,
			updatePath,
		}}
	/><CommandRuleGroup {...{ onChange, config, nextId }} />
</div>
