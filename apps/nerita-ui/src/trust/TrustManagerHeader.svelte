<!-- 信頼管理の見出しと、操作対象のバックエンドの切替を表示する。 -->
<script lang="ts">
	import "../chat/chat.css";
	import type { TrustManagerHeaderProps } from "./TrustManagerParts";
	import HelpButton from "../ui/HelpButton.svelte";
	import ComboList from "../ui/ComboList.svelte";
	import type { ConfigOption } from "@nerita/shared/composer";
	import { useHostPresentation } from "../ui/hostPresentation";

	const host = useHostPresentation();

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

<header class="flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-center gap-1">
		<h1 class="m-0 text-lg font-semibold">ワークスペースの信頼</h1>
		<HelpButton label="信頼設定の保存先">
			{#snippet content()}
				{#if backend === "codex"}
					<p class="m-0">
						{host.trust.codexStorageDescription}
					</p>
				{:else}
					<p class="m-0">
						{host.trust.piStorageDescription}
					</p>
					{#if piStoragePath}
						<p class="m-0 mt-1 [overflow-wrap:anywhere]">
							<code>{piStoragePath}</code>
						</p>
					{/if}
					{#if host.trust.piStorageKey !== ""}
						<p class="m-0 mt-1">
							保存キー: <code>{host.trust.piStorageKey}</code>
						</p>
					{/if}
				{/if}
			{/snippet}
		</HelpButton>
	</div>
	<div
		class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-[12px]"
	>
		<span>バックエンド</span>
		<ComboList
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
</header>
