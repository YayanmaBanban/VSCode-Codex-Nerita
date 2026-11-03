<!-- 保存・適用状態と操作結果を下部へまとめ、適用と破棄の操作を提示する。 -->
<script lang="ts">
	import SettingsFooter from "../../ui/SettingsFooter.svelte";
	import ButtonCurtain from "../../ui/ButtonCurtain.svelte";
	import BadgeAlert from "@lucide/svelte/icons/badge-alert";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { parseGuardrails } from "@nerita/shared/guardrails/config";
	import { cn } from "cnfast";
	import { buttonStyle } from "./fields";
	import GuardrailsSaveButton from "./GuardrailsSaveButton.svelte";
	import type { GuardrailsEditorFooterProps } from "./GuardrailsEditorParts";

	let {
		editor,
		state,
		status,
		probe,
		formAvailable,
	}: GuardrailsEditorFooterProps = $props();
	let configError = $derived(
		formAvailable
			? null
			: "設定ファイルを読み込めません。.pi/guardrails.json を VS Code のテキストエディターで開き、エラーを修正してください。",
	);
	let error = $derived(editor.reply?.error ?? configError);
	let notice = $derived(editor.reply?.notice);
	let warnings = $derived(
		editor.reply?.result ? [] : (editor.reply?.warnings ?? []),
	);
	let unapplied = $derived(status === "保存済み・未適用");
	let hasFeedback = $derived(isNonEmptyString(error) || warnings.length > 0);
	let active = $derived(
		status !== "適用済み" || editor.locked || hasFeedback,
	);
	let canDiscard = $derived.by(() => {
		try {
			parseGuardrails(state.activeText);
			return true;
		} catch {
			return false;
		}
	});
</script>

<SettingsFooter
	{active}
	saved={isNonEmptyString(notice) && !isNonEmptyString(error)}
	noticeKey={editor.reply?.id}
	label="ガードレールの状態と操作"
>
	<div
		class="grid max-h-[35dvh] min-w-0 flex-[1_1_240px] gap-2 overflow-y-auto text-[12px] [overflow-wrap:anywhere]"
	>
		{#if isNonEmptyString(error)}
			<p role="alert" class="m-0 whitespace-pre-wrap text-tool-error">
				{error}
			</p>
		{:else}
			{#if status !== "適用済み"}
				<div role="status" class="flex items-start gap-2">
					<BadgeAlert
						size={16}
						class="shrink-0 text-warning"
						aria-hidden="true"
					/>
					<span>
						{unapplied
							? "保存済みの変更が未適用です"
							: "未保存の変更があります"}
					</span>
				</div>
			{:else if editor.locked}
				<p role="status" class="m-0">処理中…</p>
			{/if}
			{#if isNonEmptyString(notice)}
				<p role="status" class="m-0 whitespace-pre-wrap">{notice}</p>
			{/if}
			{#each warnings as warning, index (index)}
				<p role="status" class="m-0 whitespace-pre-wrap text-warning">
					{warning}
				</p>
			{/each}
		{/if}
	</div>
	<div class="ml-auto flex flex-wrap items-center justify-end gap-2">
		{#if editor.conflict}
			<button
				type="button"
				class={buttonStyle}
				disabled={editor.locked}
				onclick={editor.reload}
			>
				編集を破棄して再読込
			</button>
		{:else if status !== "適用済み"}
			<GuardrailsSaveButton
				busy={editor.busy || !formAvailable}
				onSave={() => editor.request("save", probe)}
			/>
			{#if status !== "適用済み"}
				<button
					type="button"
					class={cn(
						buttonStyle,
						"group relative isolate overflow-hidden",
					)}
					disabled={editor.busy || !canDiscard}
					onclick={() => editor.request("discard", probe)}
				>
					適用中の設定に戻す
					{#if !editor.busy && canDiscard}
						<ButtonCurtain
							name="適用中の設定に戻す"
							className="bg-red-300"
						/>
					{/if}
				</button>
			{/if}
		{/if}
	</div>
</SettingsFooter>
