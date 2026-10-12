<script lang="ts">
	import type { ResourceDecision } from "@nerita/shared/sandboxPolicy";

	import { type CommandPermissionKey } from "@nerita/shared/commandPermission";
	import {
		type SandboxBridge,
		type SandboxSnapshot,
		type SandboxRequest,
	} from "@nerita/shared/sandboxManagement";

	import { onMount } from "svelte";
	let { bridge }: { bridge: SandboxBridge } = $props();
	let snapshot = $state.raw<SandboxSnapshot>();
	let busy = $state(false);
	let error = $state("");
	onMount(() => {
		const stop = bridge.subscribe((reply) => {
			if (reply.type === "error") {
				error = reply.message;
				return;
			}
			snapshot = reply.state;
			busy = reply.busy;
		});
		bridge.postMessage({ type: "ready" });
		return stop;
	});

	import SandboxLimitations from "./SandboxLimitations.svelte";
	import CommandGrants from "./CommandGrants.svelte";
	import SandboxResources from "./SandboxResources.svelte";

	import ResourceGrants from "./ResourceGrants.svelte";
	import SandboxBackend from "./SandboxBackend.svelte";
	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	function request(message: SandboxRequest) {
		error = "";
		busy = true;
		bridge.postMessage(message);
	}

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const probe = () => request({ type: "probe" });

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const revoke = (permission: CommandPermissionKey) =>
		request({ type: "revoke", permission });
</script>

<main class="mx-auto grid max-w-4xl gap-6 p-6 font-sans text-foreground">
	<header>
		<h1 class="m-0 text-xl font-semibold">Sandbox</h1>
		<p class="text-sm text-muted">
			Pi の実行環境と、ホスト実行の承認を管理します。
		</p>
	</header>
	{#if error !== ""}
		<p role="alert" class="text-sm">{error}</p>
	{/if}{#if snapshot}
		<SandboxBackend
			{...{
				snapshot,
				busy,
				probe,
			}}
		/><SandboxLimitations /><CommandGrants
			{...{
				snapshot,
				busy,
				revoke,
			}}
		/><ResourceGrants
			{...{
				snapshot,
				busy,
				request,
			}}
		/><SandboxResources
			{...{
				snapshot,
				busy,
				decide: (decision: ResourceDecision) =>
					request({ type: "denial-action", decision }),
			}}
		/>
	{:else}
		<p role="status">読み込み中…</p>
	{/if}
</main>
