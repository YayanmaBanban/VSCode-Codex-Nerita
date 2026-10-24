<!-- Host が確認したパスと権限の変更を示し、確定操作だけを保存要求として返す。 -->
<script lang="ts">
	import ConfirmationDialog from "../ui/ConfirmationDialog.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
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

<ConfirmationDialog
	open={confirmation !== null}
	{busy}
	{onCancel}
	title="このワークスペースを信頼しますか？"
	descriptionTone="warning"
	description="安全を確認したフォルダだけを信頼してください。"
>
	{#snippet heading()}
		<ShieldCheck size={18} aria-hidden="true" />
	{/snippet}
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
			コマンドの承認とサンドボックスの設定は、引き続き適用されます。<br />
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
				class="group relative overflow-hidden rounded px-3 py-2 text-[12px] text-primary-text disabled:opacity-40"
				onclick={onCancel}
				>キャンセル<ButtonCurtain
					name="キャンセル"
					className="bg-red-300"
				/></button
			>
		</div>
	{/if}
</ConfirmationDialog>
