<!-- リソースへのアクセス拒否を説明し、Host が提示した許可・キャッシュ切替・拒否だけを要求する。 -->
<script lang="ts">
	import { type SandboxSnapshot } from "@nerita/shared/sandboxManagement";

	import { type ResourceDecision } from "@nerita/shared/sandboxPolicy";

	import { buttonStyle } from "../agentManager/managerFields";

	import { allowLabels } from "./SandboxSettingsParts";

	let {
		event,
		busy,
		decide,
	}: {
		event: SandboxSnapshot["denials"][number];
		busy: boolean;
		decide: (decision: ResourceDecision) => void;
	} = $props();
</script>

<article class="grid gap-2 rounded border border-input-border p-3 text-sm">
	<p>{`${event.resource?.kind ?? "未分類"} · ${event.requestedAccess}`}</p>
	<p class="break-all">{event.target}</p>
	<p>利用ツール: {event.estimatedTool ?? "未特定"}</p>
	<p class="text-muted">
		{event.resource?.kind === "credential"
			? "資格情報は認証設定の Credential Broker で扱います。"
			: "権限は自動追加されません。再実行は途中までの処理も繰り返します。"}
	</p>
	{#if event.actions.includes("allow")}
		{#each ["process", "session", "workspace"] as const as scope (scope)}
			<button
				type="button"
				class={buttonStyle}
				disabled={busy}
				onclick={() =>
					decide({
						denialEventId: event.id,
						action: "allow",
						scope,
					})}
			>
				{allowLabels[scope]}
			</button>
		{/each}
	{/if}
	{#if event.actions.includes("use-sandbox-cache")}
		<button
			type="button"
			class={buttonStyle}
			disabled={busy}
			onclick={() =>
				decide({
					denialEventId: event.id,
					action: "use-sandbox-cache",
				})}
		>
			Sandbox キャッシュを使用して再実行
		</button>
	{/if}
	{#if event.actions.includes("deny")}
		<button
			type="button"
			class={buttonStyle}
			disabled={busy}
			onclick={() => decide({ denialEventId: event.id, action: "deny" })}
		>
			拒否して終了
		</button>
	{/if}
</article>
