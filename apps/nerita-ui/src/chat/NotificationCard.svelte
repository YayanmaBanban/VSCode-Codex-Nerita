<!-- 入力欄の上に送信結果と残り表示時間を示し、閉じる操作を提供する。 -->
<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { prefersReducedMotion } from "svelte/motion";

	let {
		children,
		onClose,
		backgroundColor,
		duration = 2000,
	}: {
		children: string;
		onClose: () => void;
		backgroundColor?: string | undefined;
		duration?: number;
	} = $props();
	let progress = $state<HTMLDivElement>();
	// 文言やコールバックの差し替えでは寿命を延長せず、最新の閉じる操作を使う。
	$effect(() => {
		const timeout = setTimeout(() => onClose(), duration);
		return () => clearTimeout(timeout);
	});
	// 残り時間の DOM アニメーションを開始し、設定変更や通知の破棄では停止する。
	$effect(() => {
		const animation = progress?.animate(
			[{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
			{
				duration,
				easing: prefersReducedMotion.current
					? "steps(4, end)"
					: "linear",
				fill: "forwards",
			},
		);
		return () => animation?.cancel();
	});
</script>

<div
	class="notification-card mx-[14px] mt-2 overflow-hidden rounded-md border border-input-border bg-input text-input-text"
	style:background-color={backgroundColor}
>
	<div class="flex items-start gap-2 px-3 py-2">
		<p
			role="status"
			class="m-0 line-clamp-2 min-w-0 flex-1 text-[12px] leading-[1.5] [overflow-wrap:anywhere]"
			title={children}
		>
			{children}
		</p>
		<button
			type="button"
			aria-label="通知を閉じる"
			onclick={onClose}
			class="flex h-5 w-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:text-input-text focus-visible:outline-2 focus-visible:outline-focus"
			><X size={14} aria-hidden="true" /></button
		>
	</div>
	<div
		bind:this={progress}
		aria-hidden="true"
		class="notification-progress h-[2px] origin-left bg-current opacity-30"
	></div>
</div>
