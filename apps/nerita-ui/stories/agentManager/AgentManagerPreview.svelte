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
		onConnect,
	}: {
		mode: string;
		onRequest: (message: ManagerRequest) => void;
		initialState?: Partial<ManagerState>;
		onConnect?: (update: (patch: Partial<ManagerState>) => void) => void;
	} = $props();
	let bridge = $derived(mockBridge(mode, onRequest, initialState));
	// ストーリーの引数変更でブリッジが変わるため、Host 更新用コールバックを再登録する。
	$effect(() => {
		onConnect?.(bridge.update);
	});
</script>

{#key bridge}
	<AgentManager {bridge} />
{/key}
