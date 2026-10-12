<!-- 認証状態に合わせて説明と操作を共通の配置で表示する。 -->
<script lang="ts">
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import ActionNotice from "../../ui/ActionNotice.svelte";
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
		if (!authenticating) {
			return state.piAccount !== null
				? "Piの認証情報を設定してください。"
				: "ChatGPTにログインするか、VSCodeの起動環境に設定したAPIキーを使用します。";
		}
		return state.piAccount !== null
			? "エディターの「Pi 認証情報」で設定してください。画面を閉じるとチャットへ戻れます。"
			: "ブラウザでログインを完了してください。最大3分間待機します。";
	}
</script>

<ActionNotice
	label="認証"
	className="auth-card"
	title={authenticating ? "認証を待っています" : "認証が必要です"}
	{description}
	{actions}
/>
