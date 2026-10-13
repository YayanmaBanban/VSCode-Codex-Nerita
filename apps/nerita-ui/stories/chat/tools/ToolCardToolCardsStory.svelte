<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { initialState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { AsyncTask } from "@nerita/shared/asyncTask";
	import Activity from "../../../src/chat/Activity.svelte";
	import { commandTools } from "../fixtures/toolCommands";
	import "../../../src/chat/chat.css";
	import { initialTools } from "./ToolCardData";
	import CompleteToolsButton from "./ToolCardCompleteToolsButton.svelte";

	let {
		background = false,
		commands = false,
	}: {
		background?: boolean;
		commands?: boolean;
	} = $props();
	let tools = $state.raw(
		(() => {
			const source = commands ? commandTools : initialTools;
			if (!background) {
				return source;
			}
			return source
				.filter((tool) => tool.id === "execute")
				.map((tool) => ({ ...tool, status: "completed" as const }));
		})(),
	);
	function setTools(
		value: typeof tools | ((current: typeof tools) => typeof tools),
	) {
		tools = typeof value === "function" ? value(tools) : value;
	}
	let asyncTasks = $state.raw<AsyncTask[]>([
		{
			asyncTaskId: "different-task-id",
			toolCallId: "execute",
			state: "running",
			canStop: true,
		},
	]);
	function setTasks(
		value:
			| typeof asyncTasks
			| ((current: typeof asyncTasks) => typeof asyncTasks),
	) {
		asyncTasks = typeof value === "function" ? value(asyncTasks) : value;
	}
	let request = $state.raw<UiMessage | undefined>(undefined);
	function setRequest(
		value: typeof request | ((current: typeof request) => typeof request),
	) {
		request = typeof value === "function" ? value(request) : value;
	}
</script>

<main style:padding="16px">
	<CompleteToolsButton {setTasks} {setTools}></CompleteToolsButton>
	<Activity
		state={{
			...initialState(),
			connection: "ready",
			sessionId: "session-test",
			runId: "run-test",
			run: background ? "completed" : "running",
			tools,
			asyncTasks,
		}}
		send={(message: UiMessage) => {
			setRequest(message);
			if (message.type === "execution/stop") {
				setTasks((tasks) =>
					tasks.map((task) => ({
						...task,
						state: background ? "stopped" : "failed",
						canStop: false,
					})),
				);
				setTools((current) =>
					current.map((tool) =>
						tool.id === message.toolId
							? {
									...tool,
									status: "failed",
								}
							: tool,
					),
				);
			}
		}}
	></Activity>
	<output aria-label="送信した要求">
		{request && JSON.stringify(request)}
	</output>
</main>
