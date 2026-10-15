<!-- Host が確認したパスと権限の変更を示し、確定操作だけを保存要求として返す。 -->
<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import { cn } from "cnfast";
	import ShieldCheck from "@lucide/svelte/icons/shield-check";
	import type { TrustConfirmation } from "@nerita/shared/workspaceTrust";

	let {
		confirmation,
		busy,
		onConfirm,
		onCancel,
	}: {
		confirmation: TrustConfirmation | null;
		busy: boolean;
		onConfirm: (confirmation: TrustConfirmation) => void;
		onCancel: () => void;
	} = $props();
</script>

<AlertDialog.Root
	bind:open={
		() => confirmation !== null,
		(open: boolean) => {
			if (!open && !busy) {
				onCancel();
			}
		}
	}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
		<AlertDialog.Content
			class={cn(
				"fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
				"rounded-lg border border-menu-border bg-menu p-5 text-menu-text shadow-lg",
			)}
		>
			<AlertDialog.Title
				class="m-0 flex items-center gap-2 text-[14px] font-semibold"
			>
				<ShieldCheck
					size={18}
					aria-hidden="true"
				/>このワークスペースを信頼しますか？
			</AlertDialog.Title>
			<AlertDialog.Description
				class="mt-3 text-[12px] leading-relaxed text-warning"
			>
				安全を確認したフォルダだけを信頼してください。
			</AlertDialog.Description>
			{#if confirmation}
				<p
					class="my-3 rounded border border-input-border bg-input p-3 font-editor text-[12px] [overflow-wrap:anywhere]"
				>
					{confirmation.canonical}
				</p>
				<p class="my-2 text-[12px]">
					{confirmation.backend === "codex" ? "Codex" : "Pi"} : {confirmation.external
						? "外部から取得したフォルダ"
						: "ユーザーが選択したフォルダ"}
				</p>
				<p class="my-3 text-[12px] leading-relaxed text-muted">
					信頼すると、フォルダ内のコードを実行できるようになり、<br />
					PowerShell・テスト・ビルド・インストールなどの操作が可能になります。<br
					/>
					コマンドの承認とサンドボックスの設定は、引き続き適用されます。<br
					/>
				</p>
				<div class="flex flex-wrap justify-end gap-2">
					<button
						type="button"
						disabled={busy}
						class="rounded border-0 bg-primary px-3 py-2 text-[12px] text-primary-text"
						onclick={() => {
							onConfirm(confirmation);
						}}>{busy ? "保存中…" : "このフォルダを信頼する"}</button
					>
					<button
						type="button"
						disabled={busy}
						class={cn(
							"cancel-button relative overflow-hidden rounded px-3 py-2 text-[12px] transition-colors duration-200",
							"enabled:hover:text-white enabled:focus-visible:text-white",
						)}
						onclick={onCancel}
						><span
							class="cancel-curtain pointer-events-none absolute inset-0 bg-red-400"
							aria-hidden="true"
						></span>
						<span class="relative">キャンセル</span></button
					>
				</div>
			{/if}
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<style>
	/* 対角線を保った三角形を広げ、左上から右下へボタン全体を覆う。 */
	.cancel-curtain {
		clip-path: polygon(0 0, 0 0, 0 0);
		transition: clip-path 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.cancel-button:enabled:is(:hover, :focus-visible) .cancel-curtain {
		clip-path: polygon(0 0, 200% 0, 0 200%);
	}
	@media (prefers-reduced-motion: reduce) {
		.cancel-curtain,
		.cancel-button {
			transition: none;
		}
	}
</style>
