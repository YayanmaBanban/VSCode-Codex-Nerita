<!-- 説明と操作ボタンを持つ固定通知の見た目を共有する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Info from "@lucide/svelte/icons/info";
	import { MediaQuery } from "svelte/reactivity";
	import { easeOut } from "motion";
	import type { TransitionConfig } from "svelte/transition";
	import ButtonCurtain from "./ButtonCurtain.svelte";
	import { noticeClass, type NoticeAction } from "./actionNoticeModel";
	/** 操作の意味と通信は利用側が担当する。 */
	type Props = {
		label: string;
		title: string;
		description: string;
		actions: NoticeAction[];
		className?: string;
	};
	let { label, title, description, actions, className }: Props = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");

	/** 元の通知と同じ独立した不透明度・移動時間で表示する。 */
	function enterNotice(node: HTMLElement): TransitionConfig {
		node.setAttribute("aria-hidden", "false");
		node.inert = false;
		if (reducedMotion.current) {
			return { duration: 0 };
		}
		return {
			duration: 300,
			css: (progress) => {
				const opacity = easeOut(progress);
				const movement = Math.min(1, progress * 1.5);
				const translated = -20 * (1 - easeOut(movement));
				return `opacity: ${opacity}; transform: translateY(${translated}px);`;
			},
		};
	}

	/** 消える通知を操作対象から外し、200ms で閉じる。 */
	function leaveNotice(node: HTMLElement): TransitionConfig {
		// Outro 中はコンポーネントの描画更新が止まるため、DOM 側で即座に操作を無効にする。
		node.setAttribute("aria-hidden", "true");
		node.inert = true;
		return {
			duration: reducedMotion.current ? 0 : 200,
			css: (progress) =>
				`opacity: ${1 - easeOut(1 - progress)}; transform: translateY(${-12 * easeOut(1 - progress)}px);`,
		};
	}
</script>

<section
	class={cn(noticeClass, "shrink-0", className)}
	aria-label={label}
	aria-hidden="false"
	in:enterNotice|global
	out:leaveNotice|global
>
	<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
		<div
			class={cn(
				"flex items-center gap-2 py-[4px]",
				"[.vscode-dark_&]:[color-scheme:dark]",
				"[.vscode-high-contrast_&]:[color-scheme:dark]",
				"[.vscode-high-contrast-light_&]:[color-scheme:light]",
				"[.vscode-light_&]:[color-scheme:light]",
				"[color:light-dark(var(--nerita-foreground),color-mix(in_srgb,var(--nerita-foreground)_40%,white))]",
			)}
		>
			<Info size={16} aria-hidden="true" />
			<h2 class="m-0 text-[13px] font-medium">
				{title}
			</h2>
		</div>
		<div class="ml-auto flex shrink-0 items-center justify-end gap-[4px]">
			{#each actions as method (method.id)}
				<button
					type="button"
					class={cn(
						"group relative isolate m-0 h-8 shrink-0 overflow-hidden rounded-md",
						"border px-3",
						"bg-message-user text-[12px] leading-2 font-medium",
						"[border-color:color-mix(in_srgb,var(--nerita-button-border)_75%,transparent)]",
						"transition-colors duration-100",
						"hover:[border-color:var(--nerita-focus-border)]",
						"focus-visible:ring-1 focus-visible:ring-[var(--nerita-focus-border)]",
						"focus-visible:outline-none",
					)}
					onclick={method.onClick}
				>
					{method.name}
					<ButtonCurtain
						name={method.name}
						className={method.curtainClassName ?? "bg-sky-300"}
					/>
				</button>
			{/each}
		</div>
	</div>
	<p class="mt-2 mb-0 pl-6 text-[12px] [overflow-wrap:anywhere]">
		{description}
	</p>
</section>
