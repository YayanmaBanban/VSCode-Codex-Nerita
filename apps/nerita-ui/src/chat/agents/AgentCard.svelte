<!-- エージェントの状態と会話への入口をキーボードで操作できるカードとして表示する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type {
		AgentStatus,
		SubAgentSummary,
	} from "@nerita/shared/subAgents";
	import StatusIndicator from "../../ui/StatusIndicator.svelte";
	import type { StatusIndicatorState } from "../../ui/statusIndicatorModel";
	import { agentName } from "./agentName";
	import AgentIcon from "./AgentIcon.svelte";

	let {
		agent,
		onOpen,
	}: { agent: SubAgentSummary; onOpen: (agent: SubAgentSummary) => void } =
		$props();
	const labels: Record<AgentStatus, string> = {
		pendingInit: "準備中",
		running: "実行中",
		idle: "待機中",
		completed: "完了",
		interrupted: "停止",
		shutdown: "停止",
		errored: "エラー",
		systemError: "エラー",
		notFound: "見つかりません",
	};
	const indicatorStates: Record<AgentStatus, StatusIndicatorState> = {
		pendingInit: "idle",
		running: "running",
		idle: "idle",
		completed: "completed",
		interrupted: "warning",
		shutdown: "warning",
		errored: "error",
		systemError: "error",
		notFound: "error",
	};
	let chips = $derived(
		[
			agent.role,
			agent.agentPath.split("/").filter(Boolean).at(-1),
			agent.model,
			agent.reasoningEffort,
		].filter(isNonEmptyString),
	);
</script>

<button
	type="button"
	class="agent-card mb-3 flex w-full min-w-0 items-center gap-3 rounded-[9px] border border-solid border-message-border bg-transparent px-[14px] py-3 text-left text-inherit hover:bg-message-user focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
	onclick={() => onOpen(agent)}
	aria-label={`${agentName(agent)}の会話を表示 · ${labels[agent.status]}`}
>
	<StatusIndicator status={indicatorStates[agent.status]} /><AgentIcon
		iconKey={agent.iconKey}
	/>
	<span class="min-w-0 flex-1"
		><span class="block text-[13px] [overflow-wrap:anywhere]"
			>{agentName(agent)}</span
		><span class="mt-1 flex flex-wrap gap-2 text-[12px]"
			>{#each chips as chip, index (index)}<span
					class="agent-chip max-w-full rounded-[5px] bg-message-code px-2 py-[6px] leading-none [overflow-wrap:anywhere] text-foreground"
					>{chip}</span
				>{/each}</span
		></span
	>
</button>
