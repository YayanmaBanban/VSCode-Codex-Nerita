<!-- スマホの認証通知を再現し、PC 側のカードとモーダルを操作できるようにする。 -->
<script lang="ts">
	import { onMount } from "svelte";
	import {
		pairingLifetimeMs,
		type RemoteWorkspaceAction,
		type RemoteWorkspaceState,
	} from "@nerita/shared/remote/workspaceControls";
	import RemoteAccessSettings from "../../src/chat/composer/RemoteAccessSettings.svelte";

	const hostname = "desktop.example.ts.net";
	let access = $state.raw<RemoteWorkspaceState>({
		phase: "off",
		connected: false,
		hostname,
		pairingExpiresAt: null,
		pairingCode: null,
		error: null,
	});

	/** 設定要求に対し、Host が返す確定状態を再現する。 */
	function send(action: RemoteWorkspaceAction) {
		switch (action.type) {
			case "ui/remoteStart":
				access = {
					...access,
					hostname:
						action.hostname === "" ? hostname : action.hostname,
					phase: "on",
					pairingExpiresAt: Date.now() + pairingLifetimeMs,
					pairingCode: "12345678",
				};
				break;
			case "ui/remoteStop":
				access = {
					...access,
					phase: "off",
					pairingExpiresAt: null,
					pairingCode: null,
					connected: false,
				};
				break;
			case "ui/remotePair":
				access = {
					...access,
					pairingCode: "12345678",
					pairingExpiresAt: Date.now() + pairingLifetimeMs,
				};
				break;
			case "ui/remoteRevoke":
				access = {
					...access,
					connected: false,
					pairingCode: null,
					pairingExpiresAt: null,
				};
				break;
			case "ui/remoteDismissPairing":
				access = {
					...access,
					pairingCode: null,
					pairingExpiresAt: null,
				};
				break;
		}
	}

	onMount(() => {
		document.addEventListener("storybook:remote-paired", pair);
		return () =>
			document.removeEventListener("storybook:remote-paired", pair);
	});

	/** 同じカードで、スマホのペアリング成功と接続を受信する。 */
	function pair() {
		access = {
			...access,
			pairingCode: null,
			pairingExpiresAt: null,
			connected: true,
		};
	}
</script>

<div class="flex min-h-[240px] items-end">
	<RemoteAccessSettings state={access} {send} />
</div>
