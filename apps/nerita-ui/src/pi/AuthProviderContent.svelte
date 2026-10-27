<!-- 認証先のアカウント・通知・入力要求を表示し、認証開始を Host へ要求する。 -->
<script lang="ts">
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
	{/each}
	<ProviderFeedback {item} {feedback} />
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
						})}
				>
					{method.name}
				</button>
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
