<!-- Codex の TOML 定義を、共通の一覧と編集フォームから操作する。 -->
<script lang="ts">
	import type { AgentManagerProps } from "../agentManager/managerProps";
	import AgentBrowser from "../agentManager/AgentBrowser.svelte";
	import CodexAgentEditor from "./CodexAgentEditor.svelte";
	import AgentManagerFooter from "../agentManager/AgentManagerFooter.svelte";

	let props: AgentManagerProps = $props();
	let agents = $derived(
		props.state.agents.filter((agent) => agent.backend === "codex"),
	);
	let agent = $derived(
		agents.find((item) => item.id === props.selected) ?? agents[0],
	);
	let creating = $derived(props.selected === "new");
	let editorId = $derived(creating ? "new" : agent?.id);
</script>

<AgentBrowser
	{agents}
	selected={creating ? "new" : (agent?.id ?? "")}
	onSelect={props.onSelect}
	busy={props.busy}
>
	{#if creating || agent}
		{#key `${editorId}:${props.state.generation}`}
			<CodexAgentEditor {...props} agent={creating ? undefined : agent} />
		{/key}
	{:else}
		<p class="text-sm text-muted">
			「新しい Agent」から定義を作成できます。
		</p>
		<AgentManagerFooter
			dirty={false}
			saved={false}
			disabled
			showSave={false}
		/>
	{/if}
</AgentBrowser>
