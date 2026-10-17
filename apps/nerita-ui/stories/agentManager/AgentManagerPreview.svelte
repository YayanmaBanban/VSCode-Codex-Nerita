<!-- ストーリー引数ごとに通信状態を用意し、実際の管理画面へ渡す。 -->
<script lang="ts">
	import type {
		ManagerRequest,
		ManagerState,
	} from "@nerita/shared/agentManager/messages";
	import AgentManager from "../../src/agentManager/AgentManager.svelte";
	import { mockBridge } from "./managerStoryBridge";

	let {
		mode,
		onRequest,
		initialState,
	}: {
		mode: string;
		onRequest: (message: ManagerRequest) => void;
		initialState?: Partial<ManagerState>;
	} = $props();
	let bridge = $derived(mockBridge(mode, onRequest, initialState));
</script>

{#key bridge}<AgentManager {bridge} />{/key}
