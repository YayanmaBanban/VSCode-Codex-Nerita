<!-- 最後の実行で使った権限とアクセス拒否を表示し、拒否への対応を Host へ要求する。 -->
<script lang="ts">
	import { type SandboxSnapshot } from "@nerita/shared/sandboxManagement";

	import { type ResourceDecision } from "@nerita/shared/sandboxPolicy";

	import DenialCard from "./DenialCard.svelte";

	let {
		snapshot,
		busy,
		decide,
	}: {
		snapshot: SandboxSnapshot;
		busy: boolean;
		decide: (decision: ResourceDecision) => void;
	} = $props();
	let reports = $derived({
		"not-run": "まだ実行していません。",
		reported: "拒否イベントを受信しました。",
		empty: "拒否レポートは空です。アクセス成功を保証する結果ではありません。",
		unavailable: "拒否レポートを取得できませんでした。",
	});
</script>

<section class="grid gap-3" aria-label="開発ツールのリソース">
	<h2 class="m-0 text-lg font-semibold">開発ツールのリソース</h2>
	<p class="m-0 text-sm text-muted">
		最後の Sandbox
		実行に使用した権限です。資格情報は専用の認証設定で管理します。
	</p>
	{#if snapshot.resources.length === 0}
		<p class="m-0 text-sm">実行後に検出結果を表示します。</p>
	{/if}
	{#each snapshot.resources as resource (resource.id)}
		<details class="rounded border border-input-border p-3 text-sm">
			<summary
				>{`${resource.kind} · ${resource.tool ?? "共通"} · ${resource.access}`}</summary
			>
			<p class="break-all">{resource.target}</p>
			<p class="text-muted">{`${resource.scope} · ${resource.source}`}</p>
		</details>
	{/each}
</section>
<section class="grid gap-3" aria-label="拒否イベント">
	<h2 class="m-0 text-lg font-semibold">拒否イベント</h2>
	<p class="m-0 text-sm text-muted">{reports[snapshot.reportStatus]}</p>
	{#each snapshot.denials as event (event.id)}
		{#key event.id}
			<DenialCard {...{ event, busy, decide }} />
		{/key}
	{/each}
</section>
