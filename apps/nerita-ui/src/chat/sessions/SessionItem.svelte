<!-- セッションの概要と、開く・名前変更・削除・分岐の独立した操作を表示する。 -->
<script lang="ts">
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import Archive from "@lucide/svelte/icons/archive";
	import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
	import GitFork from "@lucide/svelte/icons/git-fork";
	import Pencil from "@lucide/svelte/icons/pencil";
	import type { UiMessage } from "@nerita/shared/messages";
	import type {
		SessionSummary,
		SessionCapabilities,
	} from "@nerita/shared/sessionHistory";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import SessionDelete from "./SessionDelete.svelte";
	import SessionRename from "./SessionRename.svelte";
	import { relativeTime } from "./relativeTime";
	import { sessionActionClass } from "./sessionStyles";

	let {
		session,
		selected,
		now,
		disabled,
		capabilities,
		send,
	}: {
		session: SessionSummary;
		selected: boolean;
		now: number;
		disabled: boolean;
		capabilities: SessionCapabilities;
		send: (message: UiMessage) => void;
	} = $props();
	let renaming = $state(false);
	const title = $derived(
		nonEmptyString(session.title?.trim()) ?? "無題のセッション",
	);
	const archived = $derived(session.archived === true);
	const archiveLabel = $derived(
		archived ? "アーカイブから戻す" : "アーカイブ",
	);
	const forkUnavailable = $derived(
		disabled || !capabilities.fork || !capabilities.load,
	);
	const forkDisabled = $derived(forkUnavailable || session.archived);
	const canArchive = $derived(
		(archived ? capabilities.unarchive : capabilities.archive) === true,
	);
</script>

<li
	class={cn(
		"session-item mb-[4px] rounded-[7px] border border-solid focus-within:bg-menu-hover hover:bg-menu-hover hover:brightness-110",
		selected ? "border-focus bg-menu-hover" : "border-transparent bg-menu",
	)}
>
	<SettingsTooltip content={title}>
		{#snippet children({ props })}
			<button
				{...mergeProps(props, {
					onclick: () =>
						send({
							type: "session/load",
							requestId: crypto.randomUUID(),
							sessionId: session.sessionId,
						}),
				})}
				type="button"
				class={cn(
					"block w-full rounded-[6px] border-0 bg-transparent px-[12px] pt-[12px] pb-[5px] text-left",
					"focus-visible:outline-offset-[-2px]",
				)}
				disabled={disabled || !capabilities.load || session.archived}
				aria-current={selected ? "true" : undefined}
				aria-label={`${title}を開く`}
				><span class="block truncate text-[13px] leading-[1.6]"
					>{title}</span
				><span class="mt-[4px] block text-[12px] text-muted"
					>{relativeTime(session.updatedAt, now)}</span
				></button
			>
		{/snippet}
	</SettingsTooltip>
	{#if renaming}
		<SessionRename
			sessionId={session.sessionId}
			{title}
			{disabled}
			{send}
			close={() => {
				renaming = false;
			}}
		/>
	{/if}
	<div class="flex items-center justify-end gap-[2px] px-[8px] pb-[6px]">
		<SessionDelete
			{session}
			disabled={disabled || !capabilities.delete}
			{send}
		/>
		<SettingsTooltip content="名前を変更">
			{#snippet children({ props })}
				<button
					{...mergeProps(props, {
						onclick: () => {
							renaming = true;
						},
					})}
					type="button"
					class={sessionActionClass}
					aria-label={`${title}の名前を変更`}
					disabled={disabled ||
						capabilities.rename !== true ||
						session.archived}
					><Pencil size={14} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
		<SettingsTooltip content={archiveLabel}>
			{#snippet children({ props })}
				<button
					{...mergeProps(props, {
						onclick: () =>
							send({
								type: archived
									? "session/unarchive"
									: "session/archive",
								requestId: crypto.randomUUID(),
								sessionId: session.sessionId,
							}),
					})}
					type="button"
					class={sessionActionClass}
					disabled={disabled || !canArchive}
					aria-label={`${title}を${archiveLabel}`}
					>{#if archived}<ArchiveRestore
							size={14}
							aria-hidden="true"
						/>{:else}<Archive
							size={14}
							aria-hidden="true"
						/>{/if}</button
				>
			{/snippet}
		</SettingsTooltip>
		<SettingsTooltip content="フォーク">
			{#snippet children({ props })}
				<button
					{...mergeProps(props, {
						onclick: () =>
							send({
								type: "session/fork",
								requestId: crypto.randomUUID(),
								sessionId: session.sessionId,
							}),
					})}
					type="button"
					class={sessionActionClass}
					disabled={forkDisabled}
					aria-label={`${title}をフォーク`}
					><GitFork size={14} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
	</div>
</li>
