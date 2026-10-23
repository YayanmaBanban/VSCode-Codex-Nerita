<!-- 保持中のコマンド承認と有効範囲を表示し、選択した承認の取り消しを要求する。 -->
<script lang="ts">
	import {
		commandPermissionLabel,
		type CommandPermissionKey,
	} from "@nerita/shared/commandPermission";

	import { type SandboxSnapshot } from "@nerita/shared/sandboxManagement";

	import { buttonStyle } from "../agentManager/managerFields";

	let {
		snapshot,
		busy,
		revoke,
	}: {
		snapshot: SandboxSnapshot;
		busy: boolean;
		revoke: (permission: CommandPermissionKey) => void;
	} = $props();
</script>

<section class="grid gap-3" aria-label="コマンドの承認">
	<h2 class="m-0 text-lg font-semibold">コマンドの承認</h2>
	<p class="m-0 text-sm text-muted">
		照会、スクリプト実行、インストール・通信を個別に承認します。ホスト実行は
		Sandbox の制限を受けません。
	</p>
	{#if snapshot.grants.length === 0}
		<p class="m-0 text-sm">
			保持中の承認はありません。必要な実行時に確認します。
		</p>
	{/if}
	{#each snapshot.grants as grant (JSON.stringify(grant.permission))}
		<article
			class="grid gap-2 rounded border border-input-border p-3 text-sm"
		>
			<strong
				>{`${commandPermissionLabel(grant.permission)} · ${grant.permission.commandClass}`}</strong
			>
			<span
				>{`${grant.permission.route} · ${grant.scope === "workspace" ? "このワークスペース" : "セッション中"}`}</span
			>
			<span class="break-all text-muted"
				>{grant.permission.workspace}</span
			>
			<button
				type="button"
				class={buttonStyle}
				disabled={busy}
				onclick={() => revoke(grant.permission)}
				>承認を取り消す
			</button>
		</article>
	{/each}
</section>
