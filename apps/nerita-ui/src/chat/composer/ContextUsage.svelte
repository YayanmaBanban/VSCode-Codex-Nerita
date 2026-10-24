<!-- 会話のコンテキスト使用率を円形ゲージで表示し、使用量の詳細と動きを減らす設定を反映する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { untrack } from "svelte";
	import { Tween } from "svelte/motion";
	import { cubicOut } from "svelte/easing";
	import { MediaQuery } from "svelte/reactivity";
	import type { ContextUsage as Usage } from "@nerita/shared/composer";
	import Tooltip from "../../ui/Tooltip.svelte";

	let { usage }: { usage: Usage | null } = $props();
	const progress = new Tween(0);
	const reduced = new MediaQuery("(prefers-reduced-motion: reduce)");
	let percent = $derived(
		usage ? Math.min(100, (usage.used / usage.size) * 100) : 0,
	);
	let label = $derived(
		usage
			? `${usage.used / 1000}K/${usage.size / 1000}K (${Number(percent.toFixed(1))}%)`
			: "使用量は未取得です",
	);
	// 使用量と動きを減らす設定の変化を Tween へ渡し、旧アニメーションを停止する。
	$effect(() => {
		const target = percent;
		const duration =
			reduced.current || target <= untrack(() => progress.current)
				? 0
				: 600;
		void progress.set(target, { duration, easing: cubicOut });
		return () => {
			void progress.set(
				untrack(() => progress.current),
				{ duration: 0 },
			);
		};
	});
</script>

<Tooltip>
	{#snippet content()}
		<span>コンテキスト</span>
		<hr />
		<span>{label}</span>
	{/snippet}
	{#snippet children({ props })}
		<button
			{...props}
			type="button"
			class={cn(
				"context-usage inline-flex flex-[0_0_24px] border-0 bg-transparent p-0 text-muted",
				"data-[warning=true]:text-warning",
				"[&_circle]:fill-none [&_circle]:stroke-current [&_circle]:stroke-2",
			)}
			role="progressbar"
			aria-label="コンテキスト使用量"
			aria-valuemin={0}
			aria-valuemax={usage?.size ?? 100}
			aria-valuenow={usage ? Math.min(usage.used, usage.size) : undefined}
			aria-valuetext={`context: ${label}`}
			tabindex={0}
			data-warning={percent > 50}
		>
			<svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true"
				><circle
					class="context-track opacity-20"
					cx={12}
					cy={12}
					r={8}
				/><circle
					class="context-fill origin-center [transform:rotate(-90deg)] [stroke-linecap:round]"
					cx={12}
					cy={12}
					r={8}
					pathLength={100}
					stroke-dasharray="100"
					style:stroke-dashoffset={100 - progress.current}
				/></svg
			>
		</button>
	{/snippet}
</Tooltip>
