<!-- フォルダの信頼状態と登録元を表示し、信頼の変更・記録の削除を要求する。 -->
<script lang="ts">
	import "../chat/chat.css";
	import { cn } from "cnfast";
	import ShieldCheck from "@lucide/svelte/icons/shield-check";
	import ShieldAlert from "@lucide/svelte/icons/shield-alert";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import HoldToDeleteButton from "../ui/HoldToDeleteButton.svelte";

	import {
		buttonStyle,
		origins,
		type TrustRecordProps,
	} from "./TrustManagerParts";

	let { record, busy, send }: TrustRecordProps = $props();
	let holding = $state(false);
	const trustLabels = {
		trusted: "信頼済み",
		untrusted: "未信頼",
		unset: "未設定",
	};
</script>

<article
	class={cn(
		"flex min-w-0 items-center gap-3 border-b border-input-border px-3 py-4",
		"last:border-b-0 sm:px-4",
	)}
>
	{#if record.trust === "trusted"}<ShieldCheck
			size={18}
			class="shrink-0 text-menu-check"
			aria-hidden="true"
		/>{:else}<ShieldAlert
			size={18}
			class="shrink-0 text-muted"
			aria-hidden="true"
		/>{/if}
	<div class="min-w-0 flex-1">
		<h2
			class="m-0 text-[13px] leading-5 font-semibold [overflow-wrap:anywhere]"
		>
			{record.root}
		</h2>
		<p class="m-0 mt-2 text-[12px] leading-4 text-muted">
			{trustLabels[record.trust]}{#if record.origin !== "workspace"}<span>
					· {origins[record.origin]}</span
				>{/if}
		</p>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		<button
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
		<SettingsTooltip content="設定ファイルから削除" disabled={holding}>
			{#snippet children({ props })}
				<HoldToDeleteButton
					label={`${record.root}を設定ファイルから削除`}
					disabled={busy}
					tone="neutral"
					bind:holding
					triggerProps={props}
					onDelete={() => send({ type: "remove", root: record.root })}
				/>
			{/snippet}
		</SettingsTooltip>
	</div>
</article>
