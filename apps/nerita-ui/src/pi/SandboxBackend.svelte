<!-- 実行環境の利用可否と対応機能を表示し、起動確認を Host へ要求する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	import { type SandboxSnapshot } from "@nerita/shared/sandboxManagement";

	import { buttonStyle, inputStyle } from "../agentManager/managerFields";

	let {
		snapshot,
		busy,
		probe,
	}: {
		snapshot: SandboxSnapshot;
		busy: boolean;
		probe: () => void;
	} = $props();
</script>

<section class="grid gap-3" aria-label="実行環境">
	<label class="grid gap-2 text-sm"
		>実行環境
		<select
			class={inputStyle}
			value={snapshot.selected}
			disabled={busy}
			onchange={() => {}}
			><option value="mxc">Microsoft MXC</option><option
				value="docker"
				disabled
				>Docker（準備中）
			</option></select
		></label
	>
	{#each snapshot.availability.filter((backend) => backend.id === "mxc") as backend (backend.id)}
		<div class="grid gap-2 text-sm">
			<p class="m-0">
				{backend.available
					? "利用可能"
					: "利用不可・未検査"}{#if isNonEmptyString(backend.isolationTier)}
					{` · ${backend.isolationTier}`}
				{/if}
			</p>
			{#if isNonEmptyString(backend.reason)}
				<p class="m-0 break-words text-muted">{backend.reason}</p>
			{/if}
			<details>
				<summary>対応機能</summary>
				<ul>
					{#each Object.entries(backend.uiCapabilities) as [name, available] (name)}
						<li class="break-words">
							{name}: {available ? "対応" : "非対応"}
						</li>
					{/each}
				</ul>
			</details>
		</div>
	{/each}
	<button type="button" class={buttonStyle} disabled={busy} onclick={probe}
		>{busy ? "処理中…" : "起動を確認"}</button
	>
</section>
