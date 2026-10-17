<script lang="ts">
	// 子の読み取りだけをモックし、親への移動と停止の操作は実コンポーネントを使う。
	import { agentIconKeys } from "@nerita/shared/subAgents";
	import StoryChat from "./StoryChat.svelte";
	import AgentCard from "../../src/chat/agents/AgentCard.svelte";
	import AgentSourceStory from "./AgentSourceStory.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";
	import { child, grandchild } from "./agentStoryState";

	let {
		running = false,
		display = "viewer",
		readState = "ready",
	}: {
		running?: boolean;
		display?: "viewer" | "states" | "icons" | "sources";
		readState?: "ready" | "loading" | "error" | "empty";
	} = $props();
	/** 親会話と子・孫の初期表示をストーリーごとに独立して用意する。 */
	function initialBridge() {
		const mock = createChatStoryBridge();
		mock.patchState({
			...(running ? { run: "running" as const, runId: "story-run" } : {}),
			agents: [child, grandchild],
			messages: [
				{
					id: "user",
					role: "user",
					text: "この機能を調べて",
					order: 1,
				},
				{
					id: "assistant",
					role: "assistant",
					text: "調査を依頼しました。",
					order: 3,
				},
			],
		});
		return mock;
	}
	function createBridge() {
		const mock = initialBridge();
		const post = mock.postMessage.bind(mock);
		mock.postMessage = (message) => {
			if (message.type !== "agent/read") {
				post(message);
				return;
			}
			mock.sent.push(message);
			if (readState !== "ready" && readState !== "empty") {
				if (readState === "error") {
					queueMicrotask(() =>
						mock.emit({
							type: "request/failed",
							requestId: message.requestId,
							error: "子エージェントの会話を取得できませんでした。",
						}),
					);
				}
				return;
			}
			queueMicrotask(() =>
				mock.emit({
					type: "agent/view",
					requestId: message.requestId,
					view: {
						threadId: message.threadId,
						parentThreadId:
							message.threadId === "child"
								? "story-session"
								: "child",
						messages:
							readState === "empty"
								? []
								: [
										{
											id: "child-question",
											role: "user",
											text: "通知処理を調査してください。",
											order: 1,
										},
										{
											id: "child-answer",
											role: "assistant",
											text:
												message.threadId === "child"
													? "通知の処理を確認しました。"
													: "孫エージェントの調査結果です。",
											order: 3,
										},
									],
						tools: [],
						agents:
							message.threadId === "child" &&
							readState !== "empty"
								? [grandchild]
								: [],
					},
				}),
			);
		};
		return mock;
	}
	const bridge = createBridge();
	const statuses = [
		"pendingInit",
		"running",
		"idle",
		"completed",
		"interrupted",
		"shutdown",
		"errored",
		"systemError",
		"notFound",
	] as const;
</script>

{#if display === "states"}<main class="p-5">
		{#each statuses as status (status)}<AgentCard
				agent={{
					...child,
					status,
					nickname:
						status === "running"
							? "long-agent-name-for-reviewing-thread-notifications"
							: status,
				}}
				onOpen={() => {}}
			/>{/each}
	</main>
{:else if display === "icons"}<main class="grid grid-cols-2 gap-3 p-5">
		{#each agentIconKeys as iconKey (iconKey)}<AgentCard
				agent={{ ...child, iconKey, nickname: iconKey, status: "idle" }}
				onOpen={() => {}}
			/>{/each}
	</main>
{:else if display === "sources"}<AgentSourceStory />
{:else}<StoryChat {bridge} />{/if}
