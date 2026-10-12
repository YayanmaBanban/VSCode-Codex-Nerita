<!-- メッセージ・ツール・子スレッドを同じタイムラインへ並べる。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { SubAgentSummary } from "@nerita/shared/subAgents";
	import { messageTimeline, type MessageTimeline } from "./messageTimeline";
	import type { ConversationVirtualizer } from "./useConversationVirtualizer.svelte";
	import TimelineEntryView from "./TimelineEntryView.svelte";
	import { SvelteMap } from "svelte/reactivity";
	let {
		messages,
		busy: _busy,
		send,
		tools = [],
		renderTool,
		agents = [],
		renderAgent,
		timeline,
		virtual,
	}: {
		messages: ChatMessage[];
		busy: boolean;
		send?: ((message: UiMessage) => void) | undefined;
		tools?: ToolSummary[];
		renderTool?: Snippet<[ToolSummary]> | undefined;
		agents?: SubAgentSummary[];
		renderAgent?: Snippet<[SubAgentSummary]> | undefined;
		timeline?: MessageTimeline | undefined;
		virtual?: ConversationVirtualizer | undefined;
	} = $props();
	const elements = new SvelteMap<string, HTMLElement>();
	const data = $derived(timeline ?? messageTimeline(messages, tools, agents));

	/** 単独表示は DOM、仮想一覧は元データからターン移動先を解決する。 */
	function jump(id: string) {
		if (virtual) {
			virtual.reveal(`message:${id}`, true);
			return;
		}
		const element = elements.get(id);
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({ block: "start", behavior: "instant" });
	}
	/** 仮想行が外れたら DOM 参照を破棄する。 */
	function register(id: string, element: HTMLElement) {
		elements.set(id, element);
		return () => {
			elements.delete(id);
		};
	}
</script>

{#if !virtual}
	{#each data.entries as entry (entry.key)}<div
			data-entry-key={entry.key}
			class="flow-root"
		>
			<TimelineEntryView
				{entry}
				{renderTool}
				{renderAgent}
				{send}
				{jump}
				{register}
			/>
		</div>{/each}
{:else}
	<div
		bind:this={virtual.list}
		class="relative w-full"
		data-entry-count={data.entries.length}
		style:height={`${virtual.virtualizer.getTotalSize()}px`}
	>
		{#each virtual.virtualizer.getVirtualItems() as item (item.key)}
			{@const entry = data.entries[item.index]}
			{#if entry}<div
					data-index={item.index}
					data-entry-key={entry.key}
					class="absolute top-0 left-0 flow-root w-full"
					style:transform={`translateY(${item.start - virtual.virtualizer.options.scrollMargin}px)`}
					{@attach (element: HTMLElement) => {
						virtual?.virtualizer.measureElement(element);
						return () => virtual?.virtualizer.measureElement(null);
					}}
				>
					<TimelineEntryView
						{entry}
						{renderTool}
						{renderAgent}
						{send}
						{jump}
						{register}
					/>
				</div>{/if}
		{/each}
	</div>
{/if}
