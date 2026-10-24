<!-- フォルダの信頼状態を表示し、信頼の変更・記録の削除を要求する。 -->
<script lang="ts">
	import "../chat/chat.css";
	import { cn } from "cnfast";
	import ShieldCheck from "@lucide/svelte/icons/shield-check";
	import ShieldAlert from "@lucide/svelte/icons/shield-alert";
	import Tooltip from "../ui/Tooltip.svelte";
	import HoldToDeleteButton from "../ui/HoldToDeleteButton.svelte";

	import { buttonStyle, type TrustRecordProps } from "./TrustManagerParts";

	let { record, busy, send }: TrustRecordProps = $props();
	let holding = $state(false);
	const trustLabels = {
		trusted: "信頼済み",
		untrusted: "未信頼",
		unset: "未設定",
	};
</script>

<article
	data-trust-root={record.root}
	class={cn(
		"flex min-w-0 items-center gap-3 border-b border-input-border px-3 py-4",
		"last:border-b-0 sm:px-4",
	)}
>
	{#if record.trust === "trusted"}
		<ShieldCheck
			size={18}
			class="shrink-0 text-menu-check"
			role="img"
			aria-label={trustLabels[record.trust]}
		/>
	{:else}
		<ShieldAlert
			size={18}
			class="shrink-0 text-muted"
			role="img"
			aria-label={trustLabels[record.trust]}
		/>
	{/if}
	<div class="min-w-0 flex-1">
		<h2
			class="m-0 text-[13px] leading-5 font-semibold [overflow-wrap:anywhere]"
		>
			{record.root}
		</h2>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<button
				type="button"
				class={buttonStyle}
				disabled={busy || record.origin === "external-cache"}
				onclick={() =>
					send({
						type: record.trust === "trusted" ? "revoke" : "trust",
						root: record.root,
					})}
				>{record.trust === "trusted"
					? "信頼を取り消す"
					: "信頼する"}</button
			>
			<Tooltip
				content="2秒長押しで設定から削除（Enter・Spaceも長押し）"
				disabled={holding}
			>
				{#snippet children({ props })}
					<HoldToDeleteButton
						label={`${record.root}を設定ファイルから削除`}
						disabled={busy}
						tone="neutral"
						bind:holding
						triggerProps={props}
						onDelete={() =>
							send({ type: "remove", root: record.root })}
					/>
				{/snippet}
			</Tooltip>
		</div>
		{#if record.origin === "external-cache"}
			<p class="m-0 mt-2 text-[12px] text-muted">
				外部キャッシュは直接信頼できません。
			</p>
		{/if}
	</div>
</article>
