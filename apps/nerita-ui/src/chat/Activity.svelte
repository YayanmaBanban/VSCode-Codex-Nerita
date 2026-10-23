<!-- ツールごとの折り畳みカードとエージェント由来の承認選択肢を表示する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { taskActive } from "@nerita/shared/asyncTask";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { prefersReducedMotion } from "svelte/motion";
	import BorderBeam from "../ui/BorderBeam.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
	import PermissionContent from "./PermissionContent.svelte";
	import ToolCard from "./tools/ToolCard.svelte";

	let {
		state,
		send,
	}: { state: ChatState; send: (message: UiMessage) => void } = $props();
	/** 対象の実行が残っている時だけ停止要求を送る。 */
	function stop(tool: ChatState["tools"][number]) {
		const runId = tool.runId ?? state.runId;
		if (!isNonEmptyString(state.sessionId) || !isNonEmptyString(runId)) {
			return;
		}
		send({
			type: "execution/stop",
			toolId: tool.id,
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			runId,
		});
	}
	/** 承認の対象セッションと Run を送信時点で確かめる。 */
	function respond(permissionId: string, optionId: string) {
		if (!isNonEmptyString(state.sessionId)) {
			return;
		}
		if (!isNonEmptyString(state.runId)) {
			return;
		}
		send({
			type: "permission/respond",
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			runId: state.runId,
			permissionId,
			optionId,
		});
	}
	/** ツールと非同期処理を対応付け、停止可能な対象だけを有効にする。 */
	function toolActivity(tool: ChatState["tools"][number]) {
		const task = state.asyncTasks.find(
			(item) => item.toolCallId === tool.id,
		);
		const cancelTurn =
			!task && tool.runId === state.runId && state.run === "running";
		let stoppable = cancelTurn;
		if (task && taskActive(task)) {
			stoppable = task.canStop && task.stopPending !== true;
		}
		const stopContext = stoppable && isNonEmptyString(state.sessionId);
		const runContext =
			isNonEmptyString(tool.runId) || isNonEmptyString(state.runId);
		const canStop =
			stopContext && runContext && state.connection === "ready";
		return { task, cancelTurn, canStop };
	}
</script>

{#if state.tools.length > 0}
	<section aria-label="ツール実行">
		{#each state.tools as tool (`${tool.runId ?? ""}:${tool.id}`)}
			{@const activity = toolActivity(tool)}
			<ToolCard
				{tool}
				{send}
				cwd={state.cwd}
				task={activity.task}
				cancelTurn={activity.cancelTurn}
				onStop={activity.canStop ? () => stop(tool) : undefined}
			/>
		{/each}
	</section>
{/if}
{#each state.permissions as permission (permission.id)}
	<section
		class="permission-card relative my-[16px] rounded-[8px] border border-solid border-alert-border p-[16px]"
		aria-label="承認要求"
	>
		{#if !prefersReducedMotion.current}
			<span
				aria-hidden="true"
				class="pointer-events-none absolute inset-0 rounded-[inherit]"
				><BorderBeam
					size={80}
					duration={6}
					colorFrom="var(--nerita-focus-border)"
					colorTo="var(--nerita-editor-warning-foreground)"
					beamBorderRadius={8}
				/></span
			>
		{/if}
		<PermissionContent {permission} />
		<div class="permission-actions flex flex-wrap gap-[8px]">
			{#each permission.options as option (option.id)}
				<button
					type="button"
					class={option.kind === "allow"
						? "primary border-transparent bg-primary text-primary-text"
						: "quiet group relative isolate overflow-hidden bg-transparent"}
					onclick={() => respond(permission.id, option.id)}
					>{option.name}{#if option.kind !== "allow"}<ButtonCurtain
							name={option.name}
							className={option.kind === "deny"
								? "bg-red-300"
								: "bg-yellow-300"}
						/>{/if}</button
				>
			{/each}
		</div>
	</section>
{/each}
