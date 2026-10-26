<!-- パスルールの条件・判定・理由を編集し、項目の更新と例外の編集画面への移動を親へ伝える。 -->
<script lang="ts">
	import {
		inputStyle,
		buttonStyle,
		type PathRuleCardProps,
		pathRuleCardStyle,
		pathRuleFieldsStyle,
	} from "./GuardrailsRulesParts";
	import Action from "./Action.svelte";

	import PathRuleMatch from "./PathRuleMatch.svelte";
	import PathRuleOperations from "./PathRuleOperations.svelte";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import { cn } from "cnfast";

	let props: PathRuleCardProps = $props();
	let { index, rule, updatePath, onEditExceptions } = $derived(props);
	const fieldStyle = cn(inputStyle, "h-[38px]");
</script>

<section class={pathRuleCardStyle} aria-label="ルールの編集">
	<div class="p-3">
		<div class={pathRuleFieldsStyle}>
			<label class="flex min-w-0 flex-col gap-1"
				>ID
				<input
					class={fieldStyle}
					value={rule.id}
					oninput={(event) =>
						updatePath(index, {
							id: event.currentTarget.value,
						})}
				/></label
			>
			<Action
				{...{
					label: "判定",
					value: rule.action,
					onChange: (action: "allow" | "ask" | "deny") =>
						updatePath(index, { action }),
				}}
			/>
			<div class="col-span-2">
				<PathRuleMatch
					{...{
						...props,
					}}
				/>
			</div>
			<label class="col-span-2 flex flex-col gap-1"
				>相対パス / パターン
				<input
					class={fieldStyle}
					value={rule.pattern}
					oninput={(event) =>
						updatePath(index, {
							pattern: event.currentTarget.value,
						})}
				/></label
			>
			<div class="col-span-2">
				<PathRuleOperations {...{ ...props }} />
			</div>
			<label class="col-span-2 flex flex-col gap-1"
				>理由
				<textarea
					rows={4}
					maxlength={500}
					class={cn(inputStyle, "h-[96px] resize-none")}
					value={rule.reason}
					oninput={(event) =>
						updatePath(index, {
							reason: event.currentTarget.value,
						})}></textarea></label
			>
			<section
				class="col-span-2 flex min-w-0 flex-col gap-2 border-t border-panel-border pt-3"
				aria-label="例外一覧"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h3 class="m-0 text-[14px] font-semibold">
						例外 ({rule.exceptions.length})
					</h3>
					<button
						type="button"
						class={cn(
							buttonStyle,
							"inline-flex items-center gap-1.5",
						)}
						onclick={onEditExceptions}
						><ArrowRight
							size={16}
							aria-hidden="true"
						/>例外の編集</button
					>
				</div>
				<ul class="m-0 flex list-none flex-col gap-1 p-0">
					{#each rule.exceptions as exception, entry (entry)}
						<li class="break-all">{exception}</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</section>
