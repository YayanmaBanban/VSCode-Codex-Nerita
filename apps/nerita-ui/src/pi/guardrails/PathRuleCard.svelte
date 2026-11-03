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
	import Folder from "@lucide/svelte/icons/folder";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { cn } from "cnfast";

	let props: PathRuleCardProps = $props();
	let {
		index,
		rule,
		updatePath,
		onEditExceptions,
		onSelectDirectory,
		directoryBusy,
	} = $derived(props);
	const fieldStyle = cn(inputStyle, "h-[38px]");
	const patternId = $props.id();
	const patternHelpId = `${patternId}-help`;
	let showPatternHelp = $state(false);
	let showGlobHelp = $derived(showPatternHelp && rule.match === "glob");
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
			<div class="col-span-2 flex min-w-0 flex-col gap-1">
				<label for={patternId}>相対パス / パターン</label>
				<div class="relative flex min-w-0 items-center gap-2">
					<input
						id={patternId}
						aria-describedby={showGlobHelp
							? patternHelpId
							: undefined}
						class={fieldStyle}
						value={rule.match === "directory"
							? rule.directory
							: rule.pattern}
						onfocus={() => {
							showPatternHelp = true;
						}}
						onblur={() => {
							showPatternHelp = false;
						}}
						onkeydown={(event) => {
							if (event.key === "Escape") {
								showPatternHelp = false;
							}
						}}
						oninput={(event) =>
							updatePath(index, {
								[rule.match === "directory"
									? "directory"
									: "pattern"]: event.currentTarget.value,
							})}
					/>
					{#if rule.match === "directory"}
						<Tooltip content="ディレクトリの選択">
							{#snippet children({ props: triggerProps })}
								<button
									{...triggerProps}
									type="button"
									aria-label="ディレクトリの選択"
									disabled={directoryBusy}
									class={cn(
										buttonStyle,
										"flex size-[38px] shrink-0 items-center justify-center p-0",
									)}
									onclick={() => onSelectDirectory(index)}
								>
									<Folder size={18} aria-hidden="true" />
								</button>
							{/snippet}
						</Tooltip>
					{/if}
					<span
						id={patternHelpId}
						role="tooltip"
						hidden={!showGlobHelp}
						class={cn(
							"pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-max max-w-full rounded-[6px] border border-solid",
							"border-tooltip-border bg-tooltip px-3 py-2 text-[12px] leading-[1.5] text-tooltip-text",
							"shadow-[0_4px_16px_#0003]",
						)}
					>
						* は同じ階層、** は複数階層、?
						は区切り以外の1文字に一致します。
					</span>
				</div>
			</div>
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
