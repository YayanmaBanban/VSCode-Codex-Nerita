<!-- Pi のエージェント一覧と編集画面を組み立て、既定値の編集とユーザー設定の閲覧を切り替える。 -->
<script lang="ts">
	import AgentBrowser from "../agentManager/AgentBrowser.svelte";

	import { type AgentManagerProps } from "../agentManager/managerProps";
	import PiDefaultsSettings from "./PiDefaultsSettings.svelte";

	import PiAgentEditor from "./PiAgentEditor.svelte";

	let props: AgentManagerProps = $props();
	let agents = $derived(
		props.state.agents.filter((agent) => agent.backend === "pi"),
	);
	let agent = $derived(
		agents.find((item) => item.id === props.selected) ?? agents[0],
	);
	let creating = $derived(props.selected === "new");
	let defaults = $derived(
		props.selected === "defaults" || (!creating && !agent),
	);
	let selectedId = $derived(defaults ? "defaults" : (agent?.id ?? ""));
	let editorId = $derived(creating ? "new" : selectedId);
	let editorAgent = $derived(creating ? undefined : agent);
</script>

<AgentBrowser
	{agents}
	selected={editorId}
	onSelect={props.onSelect}
	busy={props.busy}
	defaults
	>{#if defaults}
		<div oninputcapture={props.onDirty}>
			{#key props.state.generation}
				<PiDefaultsSettings
					defaults={props.state.piDefaults}
					models={props.state.models.pi}
					busy={props.busy}
					save={props.save}
				/>
			{/key}
		</div>
	{:else}
		{#key `${editorId}:${props.state.generation}`}
			<PiAgentEditor {...props} agent={editorAgent} />
		{/key}
	{/if}
	<details class="mt-6">
		<summary class="cursor-pointer text-sm"
			>User 設定・Model scope（閲覧のみ）
		</summary>
		<pre class="overflow-auto text-xs">{props.state.piUserSettings}</pre>
		<pre class="overflow-auto text-xs">{props.state.modelScope}</pre>
	</details></AgentBrowser
>
