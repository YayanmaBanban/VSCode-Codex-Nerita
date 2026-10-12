<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import "../chat/chat.css";

	import AuthInput from "./AuthInput.svelte";
	import { type AuthProviderContentProps } from "./PiAuthEditorParts";

	import ProviderFeedback from "./ProviderFeedback.svelte";
	let { item, feedback, active, hostState, send }: AuthProviderContentProps =
		$props();
</script>

<div class="pr-[8px] pb-[20px] pl-[38px]">
	{#each item.accounts as account (account.id)}
		<p class="text-muted">
			{`${(account.active ? "使用中 · " : "") + account.name} · ${account.mode === "session" ? "このセッションのみ" : "VS Code に保存"}`}
		</p>
	{/each}<ProviderFeedback {item} {feedback} />
	<div class="flex flex-wrap gap-[8px]">
		{#if !active}
			{#each item.methods as method (method.id)}
				<button
					type="button"
					disabled={hostState.active !== null}
					onclick={() =>
						send({
							type: "start",
							id: method.id,
						})}>{method.name}</button
				>
			{/each}
		{/if}
	</div>
	{#if active && hostState.prompt}
		<div>
			{#key hostState.prompt.id}
				<AuthInput prompt={hostState.prompt} {send} />
			{/key}
		</div>
	{/if}
</div>
