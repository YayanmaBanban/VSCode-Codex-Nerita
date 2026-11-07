<!-- 認証状態に合わせて説明と操作を共通の配置で表示する。 -->
<script lang="ts">
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import ActionNotice from "../../ui/ActionNotice.svelte";
	import { useHostPresentation } from "../../ui/hostPresentation";

	const host = useHostPresentation();

	let {
		state,
		send,
	}: { state: ChatState; send: (message: UiMessage) => void } = $props();
	const authenticating = $derived(state.connection === "authenticating");
	const methods = $derived(authenticationMethods());
	const description = $derived(authenticationDescription());
	const actions = $derived(
		methods.map((method) => ({
			...method,
			onClick: () =>
				send({
					type: "auth/start",
					requestId: crypto.randomUUID(),
					methodId: method.id,
				}),
		})),
	);
	/** 認証待ちの Pi だけに取消操作を表示する。 */
	function authenticationMethods() {
		if (!authenticating) {
			return state.authMethods;
		}
		return state.piAccount !== null
			? [{ id: "pi-cancel", name: "認証をキャンセル" }]
			: [];
	}
	/** 認証方式と待機状態に対応する次の操作を説明する。 */
	function authenticationDescription() {
		const descriptions =
			state.piAccount !== null
				? host.authentication.pi
				: host.authentication.codex;
		return authenticating ? descriptions.pending : descriptions.required;
	}
</script>

<ActionNotice
	label="認証"
	className="auth-card"
	title={authenticating ? "認証を待っています" : "認証が必要です"}
	{description}
	{actions}
/>
