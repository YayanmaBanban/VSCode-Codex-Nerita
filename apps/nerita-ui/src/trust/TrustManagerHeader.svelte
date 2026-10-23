<!-- 信頼管理の見出しと、操作対象のバックエンドの切替を表示する。 -->
<script lang="ts">
	import "../chat/chat.css";
	import type { TrustManagerHeaderProps } from "./TrustManagerParts";
	import HelpHeader from "../ui/HelpHeader.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import type { ConfigOption } from "@nerita/shared/composer";

	let { busy, send, backend, piStoragePath }: TrustManagerHeaderProps =
		$props();
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

<HelpHeader
	title="ワークスペースの信頼"
	heading="h1"
	helpLabel="信頼設定の保存先"
>
	{#snippet actions()}
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
	{/snippet}
	{#if backend === "codex"}
		<p class="m-0">
			Codex: グローバル <code>config.toml</code> に保存
		</p>
	{:else}
		<p class="m-0">Pi: Nerita の信頼設定を VS Code のストレージに保存</p>
		{#if piStoragePath}
			<p class="m-0 mt-1 [overflow-wrap:anywhere]">
				<code>{piStoragePath}</code>
			</p>
		{/if}
		<p class="m-0 mt-1">
			保存キー: <code>nerita.workspaceTrust.v1</code>
		</p>
	{/if}
</HelpHeader>
