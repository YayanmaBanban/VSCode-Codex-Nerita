<!-- 本文をコピーし、最新の応答にだけ結果の演出を適用する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Copy from "@lucide/svelte/icons/copy";
	import { mergeProps } from "bits-ui";
	import { onDestroy } from "svelte";
	import { prefersReducedMotion } from "svelte/motion";
	import SettingsTooltip from "./SettingsTooltip.svelte";
	import "./copyButton.css";
	let {
		text,
		label,
		disabled = false,
		className,
		iconSize = 14,
	}: {
		text: string;
		label: string;
		disabled?: boolean;
		className?: string | undefined;
		iconSize?: number;
	} = $props();
	let button = $state<HTMLButtonElement>();
	let feedback = $state<{
		id: number;
		text: string;
		result: "success" | "error";
	}>();
	let request = 0;
	const current = $derived(feedback?.text === text ? feedback : undefined);
	onDestroy(() => {
		request++;
	});
	// コピー結果の表示に合わせて実 DOM を揺らし、結果変更や破棄では演出と表示タイマーを止める。
	$effect(() => {
		if (!current) {
			return;
		}
		const shake =
			current.result === "error" && !prefersReducedMotion.current
				? button?.animate(
						[
							{ transform: "translateX(0)" },
							{ transform: "translateX(-2px)" },
							{ transform: "translateX(2px)" },
							{ transform: "translateX(-2px)" },
							{ transform: "translateX(2px)" },
							{ transform: "translateX(0)" },
						],
						{ duration: 300, easing: "ease-out" },
					)
				: undefined;
		const timer = setTimeout(() => {
			feedback = undefined;
		}, 800);
		return () => {
			clearTimeout(timer);
			shake?.cancel();
		};
	});
	/** 本文の変更や後続要求をまたいだ遅い応答では、最新の表示を上書きしない。 */
	async function copy() {
		const copiedText = text;
		const id = ++request;
		let result: "success" | "error" = "success";
		try {
			await navigator.clipboard.writeText(copiedText);
		} catch {
			result = "error";
		}
		if (id === request) {
			feedback = { id, text: copiedText, result };
		}
	}
	/** コピー結果の色と、通常時のホバー色を選ぶ。 */
	function feedbackColors() {
		if (!current) {
			return "border-panel-border text-muted enabled:hover:text-foreground";
		}
		return current.result === "success"
			? "border-menu-check text-menu-check"
			: "border-tool-error text-tool-error";
	}
</script>

<SettingsTooltip content={label}>
	{#snippet children({ props })}
		<button
			{...mergeProps(props, { onclick: () => void copy() })}
			bind:this={button}
			type="button"
			aria-label={label}
			data-copy-result={current?.result}
			class={cn(
				"relative inline-flex items-center justify-center rounded-[5px] border border-solid bg-transparent p-0 focus-visible:outline-1 focus-visible:outline-settings-focus enabled:hover:bg-settings-hover disabled:opacity-50",
				feedbackColors(),
				className,
			)}
			disabled={disabled || text === ""}
		>
			<Copy size={iconSize} aria-hidden="true" />
			{#if current}<span
					class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
					aria-hidden="true"
					>{#key current.id}<span
							class={cn(
								"copy-curtain absolute inset-0",
								current.result === "success"
									? "bg-menu-check"
									: "bg-tool-error",
							)}
						></span>{/key}</span
				>{/if}
		</button>
	{/snippet}
</SettingsTooltip>
