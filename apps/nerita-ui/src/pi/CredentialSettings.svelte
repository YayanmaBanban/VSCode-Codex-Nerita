<!-- 資格情報の状態と操作結果を Host から購読し、編集画面の要求を送信する。 -->
<script lang="ts">
	import {
		type CredentialBridge,
		type CredentialReply,
		type CredentialRequest,
	} from "@nerita/shared/credentials";

	import "../chat/chat.css";

	/** 資格情報の状態応答だけを保持し、操作のエラーや通知は別に表示する。 */
	type State = Extract<CredentialReply, { type: "state" }>;

	import { onMount } from "svelte";
	import CredentialEditor from "./CredentialEditor.svelte";

	let { bridge }: { bridge: CredentialBridge } = $props();
	let snapshot = $state.raw<State>({
		type: "state",
		bindings: [],
		providers: [],
		busy: false,
	});
	let notice = $state("");
	let error = $state("");
	onMount(() => {
		const stop = bridge.subscribe((reply) => {
			if (reply.type === "state") {
				snapshot = reply;
			} else if (reply.type === "error") {
				error = reply.message;
				notice = "";
			} else {
				notice = reply.message;
				error = "";
			}
		});
		bridge.postMessage({ type: "ready" });
		return stop;
	});
</script>

<CredentialEditor
	state={snapshot}
	send={(request: CredentialRequest) => bridge.postMessage(request)}
	{notice}
	{error}
/>
