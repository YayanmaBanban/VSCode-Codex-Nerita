<!-- ヘッダーの初期状態と接続の連続変更を実チャットの通信境界で再現する。 -->
<script lang="ts">
	import StoryChat from "../StoryChat.svelte";
	import ConnectionButton from "../../../src/chat/connection/ConnectionButton.svelte";
	import {
		initialState,
		type ConnectionStatus,
	} from "@nerita/shared/chatState";
	import type { BackendId } from "@nerita/shared/backend";
	import { createCodexLifecycleBridge } from "../mocks/codexLifecycleBridge";
	import { createChatStoryBridge } from "../mocks/mockBridge";

	let {
		title = "",
		error = false,
		authFailure = false,
		authSuccess = false,
		backend = "codex",
		untrusted = false,
		transitions = false,
	}: {
		title?: string;
		error?: boolean;
		authFailure?: boolean;
		authSuccess?: boolean;
		backend?: BackendId;
		untrusted?: boolean;
		transitions?: boolean;
	} = $props();
	const bridge = $derived.by(() => {
		if (error) {
			return createCodexLifecycleBridge("reconnect");
		}
		if (authFailure) {
			return createCodexLifecycleBridge("failure");
		}
		if (authSuccess) {
			return createCodexLifecycleBridge("success");
		}
		const mock = createChatStoryBridge("completed", backend);
		mock.patchState({
			piAccount: backend === "pi" ? "local: 認証未設定" : null,
			sessionTitle: title,
			sessionCapabilities: {
				list: true,
				load: true,
				fork: true,
				delete: true,
			},
		});
		const post = mock.postMessage.bind(mock);
		return {
			...mock,
			postMessage(message: Parameters<typeof post>[0]) {
				post(message);
				if (message.type === "ui/ready") {
					mock.emit({ type: "ui/backendState", backend });
					mock.emit({ type: "workspace/trustState", untrusted });
				}
			},
		};
	});
	let chatState = $state.raw(initialState());
	const connections: ConnectionStatus[] = [
		"disconnected",
		"connecting",
		"authenticating",
		"ready",
		"error",
	];
</script>

{#if transitions}<div style="padding:24px">
		<ConnectionButton state={chatState} send={() => {}} />
		<div style="margin-top:24px;display:flex;flex-wrap:wrap;gap:8px">
			{#each connections as connection (connection)}<button
					type="button"
					onclick={() => {
						chatState = {
							...chatState,
							connection,
							sessionPending: true,
						};
					}}>{connection}</button
				>{/each}
		</div>
	</div>{:else}<StoryChat {bridge} />{/if}
