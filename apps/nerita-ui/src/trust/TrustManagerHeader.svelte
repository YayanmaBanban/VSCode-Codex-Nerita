<!-- 信頼管理の見出しと、操作対象のバックエンドの切替を表示する。 -->
<script lang="ts">
	import "../chat/chat.css";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { cn } from "cnfast";
	import type { TrustManagerHeaderProps } from "./TrustManagerParts";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import type { ConfigOption } from "@nerita/shared/composer";

	let { busy, send, backend, piStoragePath }: TrustManagerHeaderProps =
		$props();
	let expanded = $state(false);
	const helpId = $props.id();
	const backendOption = $derived({
		id: "trust-backend",
		name: "バックエンド",
		currentValue: backend,
		options: [
			{ value: "codex", name: "Codex" },
			{ value: "pi", name: "Pi" },
		],
	} satisfies ConfigOption);
</script>

<header>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-1">
			<h1 class="m-0 text-lg font-semibold">ワークスペースの信頼</h1>
			<SettingsTooltip content="ヘルプ">
				{#snippet children({ props })}
					<button
						{...props}
						type="button"
						class={cn(
							"inline-flex size-7 items-center justify-center rounded border-0 bg-transparent p-0 text-muted",
							"hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
						)}
						aria-label="信頼設定の保存先"
						aria-expanded={expanded}
						aria-controls={helpId}
						onclick={() => (expanded = !expanded)}
						><CircleQuestionMark
							size={16}
							class="mt-0.5"
							aria-hidden="true"
						/></button
					>{/snippet}</SettingsTooltip
			>
		</div>
		<div
			class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-[12px]"
		>
			<span>バックエンド</span>
			<ConfigControl
				appearance="field"
				option={backendOption}
				disabled={busy}
				onChange={(value) =>
					send({
						type: "refresh",
						backend: value === "codex" ? "codex" : "pi",
					})}
			/>
		</div>
	</div>
	<div
		id={helpId}
		class="storage-help"
		data-expanded={expanded}
		aria-hidden={!expanded}
		inert={!expanded}
	>
		<div class="min-h-0 overflow-hidden">
			<div class="pt-3 text-xs text-[12px] leading-relaxed text-muted">
				{#if backend === "codex"}
					<p class="m-0">
						Codex: グローバル <code>config.toml</code> に保存
					</p>
				{:else}
					<p class="m-0">
						Pi: Nerita workspaceTrust に保存（VSCode のストレージ）
					</p>
					{#if piStoragePath}
						<p class="m-0 mt-1 [overflow-wrap:anywhere]">
							<code>{piStoragePath}</code>
						</p>
					{/if}
					<p class="m-0 mt-1">
						保存キー: <code>nerita.workspaceTrust.v1</code>
					</p>
				{/if}
			</div>
		</div>
	</div>
</header>

<style>
	/* 内容の折り返しに追従し、閉じる途中でも再度開けるよう DOM を保持する。 */
	.storage-help {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.storage-help[data-expanded="true"] {
		grid-template-rows: 1fr;
	}
	@media (prefers-reduced-motion: reduce) {
		.storage-help {
			transition: none;
		}
	}
</style>
