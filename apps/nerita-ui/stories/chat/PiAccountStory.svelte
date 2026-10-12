<!-- ネイティブ認証画面の応答だけをモックし、実チャットで認証とモデル変更を観察する。 -->
<script lang="ts">
	import StoryChat from "./StoryChat.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";
	const bridge = (() => {
		const mock = createChatStoryBridge("empty", "pi");
		const options = [
			{ value: "local/first", name: "First (local)" },
			{ value: "local/second", name: "Second (local)" },
		];
		mock.patchState({
			piAccount: "local: 認証未設定",
			connection: "auth-required",
			authMethods: [{ id: "pi", name: "認証情報を設定" }],
			attachmentsSupported: false,
			configOptions: [
				{
					id: "model",
					name: "Pi Model",
					currentValue: "local/first",
					options,
				},
			],
		});
		return {
			...mock,
			postMessage(message: Parameters<typeof mock.postMessage>[0]) {
				mock.postMessage(message);
				if (message.type === "auth/start") {
					mock.patchState(
						message.methodId === "pi-cancel"
							? {
									connection: "auth-required",
									sessionPending: false,
								}
							: {
									connection: "authenticating",
									sessionPending: true,
								},
					);
				} else if (message.type === "config/set") {
					mock.patchState({
						connection: "ready",
						piAccount: "local: APIキー・環境設定あり",
						configOptions: [
							{
								id: "model",
								name: "Pi Model",
								currentValue: "local/second",
								options,
							},
						],
					});
				}
			},
		};
	})();
</script>

<StoryChat {bridge} />
