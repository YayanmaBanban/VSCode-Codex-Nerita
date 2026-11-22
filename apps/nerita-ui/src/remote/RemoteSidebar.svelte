<!-- 現在の作業ツリーを、共通サイドバーに表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Check from "@lucide/svelte/icons/check";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import RemoteIconAction from "./RemoteIconAction.svelte";
	import type { RemoteFilesReply } from "@nerita/shared/remote/files";
	import type { Snippet } from "svelte";
	import ResponsiveSidebar from "../ui/ResponsiveSidebar.svelte";

	let {
		changes,
		idle,
		fileBusy,
		children,
		onRefresh,
		onRead,
		onStage,
		onCommit,
		onPush,
	}: {
		changes: Extract<RemoteFilesReply, { type: "list" }> | undefined;
		idle: boolean;
		fileBusy: boolean;
		children: Snippet;
		onRefresh: () => void;
		onRead: (path: string) => void;
		onStage: (path: string) => void;
		onCommit: (message: string) => void;
		onPush: () => void;
	} = $props();
	let commitMessage = $state("");
	const changesHeading = $props.id();
</script>

<ResponsiveSidebar
	label="サイドバー"
	description="確認する変更ファイルを選択してください。"
	portalTarget=".remote-page"
	persistent
	onOpen={onRefresh}
>
	{#snippet header()}
		<div class="min-h-8" aria-hidden="true"></div>
	{/snippet}
	{#snippet expanded(select: () => void)}
		<div class="grid min-h-0 min-w-0 content-start gap-4 overflow-auto">
			<section class="grid gap-1.5" aria-label="作業ツリー">
				<div class="flex items-center justify-between gap-1.5">
					<h3 id={changesHeading} class="m-0 text-[15px]">
						変更ファイル
					</h3>
					<div class="flex min-w-0 items-center">
						<RemoteIconAction
							label="変更ファイルを更新"
							glyph={RotateCw}
							disabled={fileBusy}
							onclick={onRefresh}
						/>
						{#if changes?.push}
							<RemoteIconAction
								label="コミット済みの変更をプッシュ"
								glyph={ArrowUp}
								disabled={!idle || fileBusy}
								onclick={onPush}
							/>
						{/if}
					</div>
				</div>
				{#if changes?.files.length === 0}
					<p class="m-0">変更ファイルはありません。</p>
				{:else if changes}
					<ul
						class={cn(
							"m-0 max-h-[min(38dvh,20rem)] [scrollbar-gutter:stable] list-none overflow-auto overscroll-contain p-1",
							"divide-y divide-solid divide-panel-border rounded-lg border border-solid border-panel-border bg-input",
						)}
						aria-labelledby={changesHeading}
					>
						{#each changes.files as file (file.path)}
							{@const slash = file.path.lastIndexOf("/")}
							<li class="flex min-w-0 items-center">
								<button
									type="button"
									class={cn(
										"flex min-w-0 flex-1 items-center gap-1.5 rounded-md border-0 bg-transparent p-1 text-start text-primary-text",
										"enabled:hover:bg-settings-hover pointer-fine:min-h-8",
									)}
									aria-label={file.path}
									disabled={fileBusy}
									onclick={() => {
										onRead(file.path);
										select();
									}}
								>
									<code
										class="min-w-4 shrink-0 text-link"
										aria-hidden="true"
									>
										{file.status.trim()}
									</code>
									<span class="truncate">
										{file.path.slice(slash + 1)}
									</span>
									{#if slash >= 0}
										<small
											class="truncate text-[13px] text-muted"
										>
											{file.path.slice(0, slash)}
										</small>
									{/if}
								</button>
								{#if file.canStage}
									<div class="flex min-w-0 items-center">
										<RemoteIconAction
											label="ステージ"
											glyph={Plus}
											disabled={!idle || fileBusy}
											accessibleName={`${file.path} をステージ`}
											onclick={() => {
												onStage(file.path);
											}}
										/>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if changes?.index}
					<form
						onsubmit={(event) => {
							event.preventDefault();
							onCommit(commitMessage);
						}}
					>
						<label
							for="remote-commit"
							class="text-sm font-semibold"
						>
							コミットメッセージ
						</label>
						<div class="flex min-w-0 items-center">
							<input
								id="remote-commit"
								class="min-h-[44px] w-full min-w-0 rounded-[0.6rem] border border-solid border-input-border bg-input p-2.5 text-input-text"
								bind:value={commitMessage}
								maxlength={240}
								required
							/>
							<RemoteIconAction
								label="ステージ済みをコミット"
								glyph={Check}
								disabled={!idle || fileBusy}
							/>
						</div>
					</form>
				{/if}
			</section>
		</div>
	{/snippet}
	{@render children()}
</ResponsiveSidebar>
