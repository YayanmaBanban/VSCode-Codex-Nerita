<script lang="ts">
	import {
		type PiAuthState,
		type PiAuthRequest,
	} from "@nerita/shared/piAuth";
	import PiAuthEditor from "./PiAuthEditor.svelte";
	import { subscribePiAuth } from "../bridge/vscodeBridge";

	import { onMount } from "svelte";
	let { post }: { post: (request: PiAuthRequest) => void } = $props();
	let snapshot = $state.raw<PiAuthState>({
		items: [],
		active: null,
		prompt: null,
		notice: "読み込み中…",
		error: null,
	});
	onMount(() => {
		const unsubscribe = subscribePiAuth((state) => {
			snapshot = state;
		});
		post({ type: "ready" });
		return unsubscribe;
	});
</script>

<PiAuthEditor state={snapshot} send={post} />
