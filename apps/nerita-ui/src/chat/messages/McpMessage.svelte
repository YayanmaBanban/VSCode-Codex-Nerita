<!-- MCP の取得中表示と、接続状態の一覧をメッセージ内に描画する。 -->
<script lang="ts">
	import { MediaQuery } from "svelte/reactivity";
	import type { McpMessageContent } from "@nerita/shared/mcp";
	import ShinyText from "../../ui/ShinyText.svelte";
	import RunStatusIcon from "../RunStatusIcon.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";

	let { content, text }: { content: McpMessageContent; text: string } =
		$props();
	const servers = $derived(content.status === "ready" ? content.servers : []);
	const reduced = new MediaQuery("(prefers-reduced-motion: reduce)");
	/** 未知の接続状態は中立色で表示する。 */
	function serverStatusColor(status: string | null) {
		if (status === "connected") {
			return "bg-menu-check";
		}
		if (status === "disabled") {
			return "bg-tool-error";
		}
		return "bg-muted";
	}
</script>

{#if content.status === "loading"}
	<div
		role="status"
		aria-label="取得中…"
		class="flex items-center gap-1 text-[12px] text-muted"
	>
		<ShinyText
			text="取得中…"
			disabled={reduced.current}
			color="var(--nerita-description-foreground)"
			shineColor="var(--nerita-foreground)"
		/>
		<RunStatusIcon kind="loaf" />
	</div>
{:else}
	{#if content.status === "error"}
		<p role="alert" class="m-0 text-tool-error">
			{text}
		</p>
	{:else}
		<div>
			{#if servers.length === 0}
				<p class="m-0 text-muted">MCPサーバーはありません。</p>
			{:else}
				<p class="mt-0 mb-2">設定済みMCPサーバー:</p>
				<ul
					aria-label="MCPサーバー"
					class="m-0 flex list-none flex-col gap-2 p-0"
				>
					{#each servers as server, index (`${server.name}:${index}`)}
						<li class="flex items-start gap-2">
							<Tooltip content={server.runtimeStatus ?? "不明"}>
								{#snippet children({ props: tooltipProps })}
									<span
										{...tooltipProps}
										tabindex="-1"
										role="img"
										aria-label={server.runtimeStatus ??
											"不明"}
										class={`mt-[0.6em] size-2 shrink-0 rounded-full ${serverStatusColor(server.runtimeStatus)}`}
									></span>
								{/snippet}
							</Tooltip>
							<span class="min-w-0 [overflow-wrap:anywhere]">
								{server.name}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
{/if}
