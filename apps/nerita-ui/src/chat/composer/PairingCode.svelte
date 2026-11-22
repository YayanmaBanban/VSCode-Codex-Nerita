<!-- ペアリングコードと Host で確定した受付期限を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { onMount } from "svelte";
	import { pairingLifetimeMs } from "@nerita/shared/remote/workspaceControls";

	let { code, expiresAt }: { code: string; expiresAt: number } = $props();
	const lifetime = pairingLifetimeMs / 1000;
	let now = $state(Date.now());
	let remaining = $derived(
		Math.min(lifetime, Math.max(0, Math.ceil((expiresAt - now) / 1000))),
	);

	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 250);
		return () => clearInterval(timer);
	});
</script>

<div class="grid gap-2">
	<span class="sr-only">ペアリングコード {code}</span>
	<div class="grid grid-cols-8 gap-1 select-all" aria-hidden="true">
		{#each [...code] as digit, index (index)}
			<span
				class={cn(
					"grid aspect-square place-items-center rounded border border-input-border bg-input",
					"font-mono text-xl font-semibold text-foreground",
				)}
			>
				{digit}
			</span>
		{/each}
	</div>
	<progress
		class="w-full accent-[var(--vscode-progressBar-background,#2563b8)]"
		aria-label="ペアリングコードの残り時間"
		aria-valuetext={`残り ${remaining} 秒`}
		max={lifetime}
		value={remaining}
	></progress>
	<span class="text-center text-xs text-muted" aria-hidden="true"
		>残り {remaining} 秒</span
	>
</div>
