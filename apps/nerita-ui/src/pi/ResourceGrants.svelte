<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import {
		type SandboxSnapshot,
		type SandboxRequest,
	} from "@nerita/shared/sandboxManagement";

	import { buttonStyle } from "../agentManager/managerFields";

	import { scopeLabels } from "./SandboxSettingsParts";

	let {
		snapshot,
		busy,
		request,
	}: {
		snapshot: SandboxSnapshot;
		busy: boolean;
		request: (message: SandboxRequest) => void;
	} = $props();
</script>

<section class="grid gap-3" aria-label="リソースの許可">
	<h2 class="m-0 text-lg font-semibold">リソースの許可</h2>
	{#if snapshot.resourceGrants.length === 0}
		<p class="m-0 text-sm">追加したリソース権限はありません。</p>
	{/if}{#each snapshot.resourceGrants as grant (grant.id)}
		<article
			class="grid gap-2 rounded border border-input-border p-3 text-sm"
		>
			<strong
				>{`${grant.resource.kind} · ${grant.resource.tool} · ${grant.access}`}</strong
			><span>{scopeLabels[grant.scope]}</span><span class="break-all"
				>{grant.resource.target}</span
			><span class="break-all text-muted">{grant.workspace}</span><button
				type="button"
				class={buttonStyle}
				disabled={busy}
				onclick={() =>
					request({ type: "revoke-resource", id: grant.id })}
				>リソース権限を取り消す
			</button>
		</article>
	{/each}{#each snapshot.cacheSwitches as cache (cache.id)}
		<article
			class="grid gap-2 rounded border border-input-border p-3 text-sm"
		>
			<strong>{`${cache.tool} · Sandbox キャッシュ`}</strong><span
				class="break-all text-muted">{cache.workspace}</span
			><button
				type="button"
				class={buttonStyle}
				disabled={busy}
				onclick={() => request({ type: "revoke-cache", id: cache.id })}
				>キャッシュ切替を取り消す
			</button>
		</article>
	{/each}
</section>
