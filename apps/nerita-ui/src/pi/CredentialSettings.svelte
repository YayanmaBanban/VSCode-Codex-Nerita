<script lang="ts">
	import {
		type CredentialBridge,
		type CredentialReply,
		type CredentialRequest,
	} from "@nerita/shared/credentials";

	import "../chat/chat.css";

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
