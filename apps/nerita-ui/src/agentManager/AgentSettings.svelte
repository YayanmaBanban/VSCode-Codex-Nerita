<!-- バックエンド別の設定を受け取り、名前・説明・本文と保存操作を共通化する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		agentEditSchema,
		type AgentEdit,
	} from "@nerita/shared/agentManager/config";
	import type {
		ManagedAgent,
		ManagerModel,
	} from "@nerita/shared/agentManager/messages";
	import { reasoningLabel } from "@nerita/shared/settingsCards";
	import Field from "./Field.svelte";
	import DefinitionField from "./DefinitionField.svelte";
	import { inputStyle, buttonStyle } from "./managerFields";

	let {
		agent,
		models,
		edit,
		onChange,
		busy,
		onSubmit,
		children,
		error: inputError,
		filename,
		onFilenameChange,
	}: {
		agent?: ManagedAgent | undefined;
		models: ManagerModel[];
		edit: AgentEdit;
		onChange: (edit: AgentEdit) => void;
		busy: boolean;
		onSubmit: () => void;
		children: Snippet;
		error?: string | undefined;
		filename?: string | undefined;
		onFilenameChange?: ((name: string) => void) | undefined;
	} = $props();
	let error = $derived(
		inputError ??
			(agentEditSchema.safeParse(edit).success
				? undefined
				: "名前と入力内容を確認してください。"),
	);
	let badges = $derived([
		agent?.source ?? "project",
		models.find((item) => item.value === agent?.definitionModel)?.name ??
			agent?.definitionModel ??
			"モデル未指定",
		isNonEmptyString(agent?.definitionThinking)
			? reasoningLabel(agent.definitionThinking)
			: "推論未指定",
	]);
</script>

<form
	class="grid gap-5"
	onsubmit={(event) => {
		event.preventDefault();
		if (!isNonEmptyString(error)) {
			onSubmit();
		}
	}}
>
	<fieldset
		disabled={busy || agent?.editable === false}
		class="m-0 grid min-w-0 gap-5 border-0 p-0"
	>
		{#if edit.definition}<DefinitionField
				{edit}
				{onChange}
				field="name"
				label="名前"
				limit={80}
			/>{:else}<h2 class="m-0 text-lg font-semibold">
				{agent?.name}
			</h2>{/if}
		{#if onFilenameChange}<Field label="ファイル名"
				><input
					class={inputStyle}
					required
					pattern={"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}"}
					value={filename ?? ""}
					oninput={(event) =>
						onFilenameChange(event.currentTarget.value)}
				/></Field
			>{/if}
		{#if isNonEmptyString(agent?.definitionPath)}<p
				class="m-0 text-xs break-all text-muted"
			>
				{agent.definitionPath}
			</p>{/if}
		<div class="flex flex-wrap gap-2 text-xs text-muted">
			{#each badges as badge, index (index)}<span
					class="rounded border border-input-border px-2 py-1"
					>{badge}</span
				>{/each}
		</div>
		{#if edit.definition}<DefinitionField
				{edit}
				{onChange}
				field="description"
				label="説明"
				rows={3}
				limit={2000}
			/>{:else}<p class="m-0 text-sm text-muted">
				{agent?.description}
			</p>{/if}
		{#if isNonEmptyString(agent?.unavailableReason)}<p
				role="status"
				class="text-sm text-muted"
			>
				{agent.unavailableReason}
			</p>{/if}
		<section class="grid gap-4 border-t border-input-border pt-4">
			<h3 class="m-0 text-sm font-semibold">Agent 設定</h3>
			{@render children()}
		</section>
		<DefinitionField
			{edit}
			{onChange}
			field="prompt"
			label="システムプロンプト"
			rows={10}
			limit={60000}
		/>
		{#if isNonEmptyString(error)}<p role="alert" class="text-sm">
				{error}
			</p>{/if}<button
			type="submit"
			class={`${buttonStyle} justify-self-end`}
			disabled={isNonEmptyString(error)}>変更を保存</button
		>
	</fieldset>
</form>
