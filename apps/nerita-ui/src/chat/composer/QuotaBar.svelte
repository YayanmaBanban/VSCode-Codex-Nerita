<!-- 取得した利用枠の最小残量をバーで表示し、各利用枠の詳細をツールチップで示す。 -->
<script lang="ts">
	import type { QuotaWindow } from "@nerita/shared/composer";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import "./quotaBar.css";

	let { windows }: { windows: QuotaWindow[] | null } = $props();
	let remaining = $derived(
		windows !== null && windows.length > 0
			? Math.min(...windows.map((window) => window.remaining))
			: 0,
	);
</script>

{#if windows && windows.length > 0}
	<SettingsTooltip>
		{#snippet content()}<span>利用枠の残量</span>
			<hr />
			{#each windows as window, index (`${window.label}-${index}`)}<div>
					<div>{window.label}: {window.remaining}%</div>
					{#if window.detail !== ""}<div>{window.detail}</div>{/if}
				</div>{/each}{#if windows.some((window) => window.source === "codex-login")}<hr
				/>
				<div>Codexのログイン情報から取得中</div>{/if}{/snippet}
		{#snippet children({ props })}
			<button
				{...props}
				type="button"
				class="quota-bar inline-flex h-[24px] w-[76px] items-center rounded-[4px] border-0 bg-transparent p-0 hover:brightness-[1.12] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-quota-focus focus-visible:outline-solid"
				role="progressbar"
				aria-label="利用枠の残量"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={remaining}
				aria-valuetext={`残り ${remaining}%`}
				tabindex={0}
			>
				<span
					class="quota-track h-[9px] w-full overflow-hidden rounded-[5px] bg-quota-track"
					aria-hidden="true"
					><span
						class="quota-fill relative block h-full overflow-hidden rounded-[inherit] bg-[#58bafa]"
						style:width={`${remaining}%`}
						><svg
							class="quota-wave"
							viewBox="0 0 160 12"
							preserveAspectRatio="none"
							><path
								d="M0 6 Q20 0 40 6 T80 6 T120 6 T160 6 V12 H0Z"
							/></svg
						></span
					></span
				>
			</button>
		{/snippet}
	</SettingsTooltip>
{/if}
