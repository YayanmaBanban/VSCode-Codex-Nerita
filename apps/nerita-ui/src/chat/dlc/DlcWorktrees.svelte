<!-- 実行先メニューで現在のワークスペースと Worktree を選択し、Worktree を作成・削除する。削除には長押しを使う。 -->
<script lang="ts">
	import { Popover } from "bits-ui";
	import { cn } from "cnfast";
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Folder from "@lucide/svelte/icons/folder";
	import GitBranch from "@lucide/svelte/icons/git-branch";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import Plus from "@lucide/svelte/icons/plus";
	import ShieldAlert from "@lucide/svelte/icons/shield-alert";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import BorderBeam from "../../ui/BorderBeam.svelte";
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	import DlcWorktreeDelete from "./DlcWorktreeDelete.svelte";
	import SettingsTooltip from "../SettingsTooltip.svelte";

	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
	let open = $state(false);
	let selected = $derived(ui.selected);
	let main = $derived(ui.view.targets.find((item) => item.main));
	let worktrees = $derived(ui.view.targets.filter((item) => !item.main));
	let target = $derived(
		ui.view.targets.find((item) => item.id === ui.view.targetId) ?? main,
	);
	let active = $derived(
		ui.view.running.some((run) => run.intentId === selected?.intentId),
	);
	let selectionDisabled = $derived(
		!selected || active || ui.view.assignmentPending,
	);
	let targetBlocked = $derived(ui.view.targetBusy && !active);
	let targetName = $derived(
		target ? displayName(target) : "現在のワークスペース",
	);
	const rowClass = cn(
		"flex w-full min-w-0 flex-1 items-center gap-3 rounded-[5px] border-0 bg-transparent px-2 py-3 text-left text-[13px] text-menu-text",
		"focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus enabled:hover:bg-menu-hover",
	);

	/** 主作業領域は Worktree 名と区別して表示する。 */
	function displayName(item: DlcView["targets"][number]) {
		return item.main ? "現在のワークスペース" : item.name;
	}
	/** 現在の Intent と版を添えて選択を保存し、メニューを閉じる。 */
	function selectTarget(targetId: string) {
		if (!selected || selectionDisabled) {
			return;
		}
		ui.send({
			type: "dlc/target",
			requestId: crypto.randomUUID(),
			intentId: selected.intentId,
			revision: selected.revision,
			targetId,
		});
		open = false;
	}
	/** 作成は実行中でも使い、現在の割当は変更しない。 */
	function createWorktree() {
		ui.send({ type: "dlc/worktreeCreate", requestId: crypto.randomUUID() });
		open = false;
	}
	/** メニュー内の実行先ごとに実行予約を確認し、他の Intent が使う Worktree も削除から保護する。 */
	function removalDisabled(targetId: string) {
		const running = ui.view.running.some(
			(run) => run.targetId === targetId,
		);
		const busy = ui.view.targetBusy && ui.view.targetId === targetId;
		return running || busy || ui.view.assignmentPending;
	}
	/** 長押し完了後も最新状態を確認し、主作業領域や実行中の実行先は削除しない。 */
	function removeWorktree(targetId: string) {
		const item = ui.view.targets.find((item) => item.id === targetId);
		if (!item || item.main || !item.removable) {
			return;
		}
		if (removalDisabled(targetId)) {
			return;
		}
		ui.removals.remove(targetId);
	}
</script>

<div class="mt-5 border-0 border-t border-solid border-panel-border pt-5">
	<p class="m-0 mb-3 text-[13px]">実行先</p>
	<Popover.Root bind:open>
		<Popover.Trigger
			role="combobox"
			aria-label="DLC の Worktree"
			disabled={!selected || ui.view.assignmentPending}
			class={cn(
				"flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-[6px] border border-solid border-input-border bg-transparent px-3 py-3 text-left text-[13px] text-foreground",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
			)}
		>
			{#if target?.main !== false}
				<Folder
					size={16}
					class="shrink-0 text-muted"
					aria-hidden="true"
				/>
			{:else}
				<GitBranch
					size={16}
					class="shrink-0 text-muted"
					aria-hidden="true"
				/>
			{/if}
			<span class="min-w-0 flex-1 truncate font-semibold"
				>{targetName}{#if target && !target.trusted}<span
						class="text-tool-error">（未信頼）</span
					>{/if}</span
			>
			<ChevronDown
				size={14}
				class="shrink-0 text-muted"
				aria-hidden="true"
			/>
		</Popover.Trigger>
		<Popover.Portal>
			<Popover.Content
				role="dialog"
				side="bottom"
				align="start"
				sideOffset={6}
				collisionPadding={12}
				aria-label="実行先を選択"
				class={cn(
					"z-20 max-h-[min(420px,var(--bits-popover-content-available-height))] w-[min(var(--bits-popover-anchor-width),calc(100vw-24px))] overflow-y-auto rounded-[8px] border border-solid border-menu-border bg-menu p-2 text-menu-text",
					"shadow-[0_6px_24px_#0003]",
				)}
			>
				<p class="m-0 px-1 py-1 text-[12px] text-muted">実行先を選択</p>
				<button
					type="button"
					class={rowClass}
					disabled={selectionDisabled || !main}
					aria-pressed={target?.main === true}
					onclick={() => main && selectTarget(main.id)}
				>
					<Folder
						size={16}
						class="shrink-0 text-muted"
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1"
						><span class="block font-semibold"
							>{main
								? displayName(main)
								: "現在のワークスペース"}{#if main && !main.trusted}<span
									class="text-tool-error">（未信頼）</span
								>{/if}</span
						><span
							class="block text-[12px] [overflow-wrap:anywhere] text-muted"
							>{main?.branch ??
								ui.view.environment?.branch ??
								""}</span
						></span
					>
					{#if target?.main === true}<Check
							size={14}
							class="shrink-0 text-menu-check"
							aria-hidden="true"
						/>{/if}
				</button>
				<div
					class="mt-2 border-0 border-t border-solid border-panel-border pt-3"
				>
					<p class="m-0 px-1 pb-1 text-[12px] text-muted">
						WORKTREES
					</p>
					{#each worktrees as item (item.id)}
						<div class="flex min-w-0 items-center gap-2">
							<button
								type="button"
								class={rowClass}
								disabled={selectionDisabled ||
									ui.removals.pending(item.id)}
								aria-pressed={target?.id === item.id}
								onclick={() => selectTarget(item.id)}
							>
								<GitBranch
									size={16}
									class="shrink-0 text-muted"
									aria-hidden="true"
								/><span
									class="min-w-0 flex-1 truncate font-semibold"
									>{displayName(item)}{#if !item.trusted}<span
											class="text-tool-error"
											>（未信頼）</span
										>{/if}</span
								>
								{#if target?.id === item.id}<Check
										size={14}
										class="shrink-0 text-menu-check"
										aria-hidden="true"
									/>{/if}
							</button>
							{#if item.removable}
								<DlcWorktreeDelete
									name={item.name}
									pending={ui.removals.pending(item.id)}
									disabled={removalDisabled(item.id)}
									onDelete={() => removeWorktree(item.id)}
								/>
							{/if}
						</div>
					{/each}
				</div>
				<div
					class="mt-2 border-0 border-t border-solid border-panel-border pt-2"
				>
					<SettingsTooltip
						content="main の HEAD から作成します。未コミットの変更は含みません。"
					>
						{#snippet children({ props: tooltipProps })}
							<button
								{...tooltipProps}
								type="button"
								class={rowClass}
								disabled={ui.view.assignmentPending}
								onclick={createWorktree}
								><Plus
									size={16}
									class="shrink-0 text-muted"
									aria-hidden="true"
								/>新しいWorktreeを作成</button
							>
						{/snippet}
					</SettingsTooltip>
				</div>
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
	<div class="mt-3 flex min-w-0 items-start gap-2">
		<p
			class="m-0 flex min-w-0 flex-1 items-start gap-2 text-[12px] text-muted"
		>
			<Folder size={12} class="mt-1 shrink-0" aria-hidden="true" />
			<span class="min-w-0 [overflow-wrap:anywhere]"
				>{target?.directory ??
					ui.view.environment?.workspace ??
					"ワークスペースの確認中"}</span
			>
		</p>
		{#if target && !target.trusted}
			<SettingsTooltip content="ワークスペースを信頼する">
				{#snippet children({ props: tooltipProps })}
					<button
						{...tooltipProps}
						type="button"
						aria-label="ワークスペースを信頼する"
						class={cn(
							"relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-solid border-input-border bg-transparent p-0 text-tool-error",
							"hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
						)}
						onclick={() =>
							ui.send({
								type: "dlc/trust",
								requestId: crypto.randomUUID(),
							})}
					>
						<ShieldAlert size={16} aria-hidden="true" />
						<BorderBeam
							size={24}
							duration={4}
							colorFrom="var(--nerita-error-foreground)"
							colorTo="var(--nerita-error-foreground)"
						/>
					</button>
				{/snippet}
			</SettingsTooltip>
		{/if}
	</div>
	{#if !selected || targetBlocked || ui.view.assignmentPending}
		<div
			class="mt-3 space-y-2 border-0 border-t border-solid border-panel-border pt-3"
		>
			{#if !selected}
				<p role="status" class="m-0 text-[12px] text-muted">
					Intentの作成・選択を待っています
				</p>
			{/if}
			{#if targetBlocked}
				<p role="status" class="m-0 flex items-start gap-1 text-[12px]">
					<TriangleAlert
						size={16}
						class="mt-0.5 shrink-0 text-warning"
						aria-hidden="true"
					/>
					<span>このワークスペースでは別の実行が進行中です。</span>
				</p>
			{/if}
			{#if ui.view.assignmentPending}
				<p role="status" class="m-0 flex items-start gap-1 text-[12px]">
					<LoaderCircle
						size={16}
						class="mt-0.5 shrink-0 motion-safe:animate-spin"
						aria-hidden="true"
					/>
					<span>実行先・バックエンドの変更を保存中…</span>
				</p>
			{/if}
		</div>
	{/if}
</div>
