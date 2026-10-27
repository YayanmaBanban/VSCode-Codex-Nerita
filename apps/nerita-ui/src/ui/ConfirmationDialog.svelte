<!-- 信頼確認と編集内容の復旧で、フォーカス・スクロール・閉じる操作を共通化する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { AlertDialog } from "bits-ui";
	import { cn } from "cnfast";

	let {
		open,
		busy = false,
		title,
		description,
		onCancel,
		children,
		heading,
		descriptionTone = "muted",
	}: {
		open: boolean;
		busy?: boolean;
		title: string;
		description: string;
		onCancel: () => void;
		children: Snippet;
		heading?: Snippet;
		descriptionTone?: "muted" | "warning";
	} = $props();
</script>

<AlertDialog.Root
	bind:open={
		() => open,
		(value: boolean) => {
			if (!value && !busy) {
				onCancel();
			}
		}
	}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
		<AlertDialog.Content
			class={cn(
				"fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))]",
				"-translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-menu-border bg-menu p-5 text-menu-text shadow-lg",
			)}
		>
			<AlertDialog.Title
				class="m-0 flex items-center gap-2 text-sm font-semibold"
			>
				{#if heading}{@render heading()}{/if}{title}
			</AlertDialog.Title>
			<AlertDialog.Description
				class={cn(
					"my-3 text-xs leading-relaxed",
					descriptionTone === "warning"
						? "text-warning"
						: "text-muted",
				)}
			>
				{description}
			</AlertDialog.Description>
			{@render children()}
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
