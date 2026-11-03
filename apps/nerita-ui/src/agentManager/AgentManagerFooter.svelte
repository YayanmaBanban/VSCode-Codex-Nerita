<!-- 管理画面の保存状態と Host のエラー・再読み込み操作をまとめて表示する。 -->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { MediaQuery } from "svelte/reactivity";
	import BadgeAlert from "@lucide/svelte/icons/badge-alert";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { errorText } from "@nerita/shared/errorText";
	import { cn } from "cnfast";
	import SettingsFooter from "../ui/SettingsFooter.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
	import { buttonStyle } from "./managerFields";
	import { getManagerFeedback } from "./agentManagerFeedback";

	const feedback = getManagerFeedback();
	let errors = $derived(
		feedback.errors.map(errorText).filter(isNonEmptyString),
	);
	let reloadNeeded = $derived(feedback.reloadRequired);

	let {
		dirty,
		saved,
		disabled,
		label = "変更を保存",
		onDiscard,
		discardDisabled = false,
		showSave = true,
	}: {
		dirty: boolean;
		saved: boolean;
		disabled: boolean;
		label?: string;
		onDiscard?: (() => void) | undefined;
		discardDisabled?: boolean;
		showSave?: boolean;
	} = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
</script>

<SettingsFooter
	active={dirty || errors.length > 0}
	{saved}
	label={onDiscard ? "未保存の変更" : undefined}
>
	<div class="grid min-w-0 flex-[1_1_240px] gap-2 text-xs">
		{#if errors.length > 0}
			<div class="flex min-w-0 items-start gap-2">
				<CircleAlert
					size={16}
					class="shrink-0 text-tool-error"
					aria-hidden="true"
				/>
				<div class="grid max-h-[35dvh] min-w-0 gap-2 overflow-y-auto">
					{#each errors as error, index (index)}
						<div role="alert">
							<span
								class="min-w-0 break-words whitespace-pre-wrap"
							>
								{error}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<div role="status" aria-atomic="true">
				{#if dirty}
					<span class="flex items-center gap-2">
						<BadgeAlert
							size={16}
							class="shrink-0 text-warning"
							aria-hidden="true"
						/>
						{onDiscard
							? "未保存の変更を破棄して移動しますか？"
							: "未保存の変更があります"}
					</span>
				{:else}
					{#if saved}
						<span
							class="flex items-center gap-2"
							in:fade|global={{
								duration: reducedMotion.current ? 0 : 200,
							}}
						>
							<CircleCheck
								size={16}
								class="shrink-0 text-menu-check"
								aria-hidden="true"
							/>
							保存しました
						</span>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
	<div class="ml-auto flex flex-wrap items-center justify-end gap-2">
		{#if reloadNeeded}
			<button
				type="button"
				class={cn(
					buttonStyle,
					"group relative isolate shrink-0 overflow-hidden",
				)}
				disabled={feedback.busy}
				onclick={feedback.reload}
			>
				<span class="flex items-center gap-2"
					><RotateCw size={16} aria-hidden="true" />再読み込み</span
				>
				{#if !feedback.busy}
					<ButtonCurtain name="再読み込み" className="bg-sky-300" />
				{/if}
			</button>
		{:else}
			{#if showSave}
				<button
					type="submit"
					class={cn(
						buttonStyle,
						"group relative isolate shrink-0 overflow-hidden",
					)}
					{disabled}
				>
					{label}
					{#if !disabled}
						<ButtonCurtain name={label} className="bg-sky-300" />
					{/if}
				</button>
			{/if}
			{#if onDiscard}
				<button
					type="button"
					onclick={onDiscard}
					disabled={discardDisabled}
					class={cn(
						buttonStyle,
						"group relative isolate shrink-0 overflow-hidden",
					)}
				>
					変更を破棄
					{#if !discardDisabled}<ButtonCurtain
							name="変更を破棄"
							className="bg-red-300"
						/>{/if}
				</button>
			{/if}
		{/if}
	</div>
</SettingsFooter>
