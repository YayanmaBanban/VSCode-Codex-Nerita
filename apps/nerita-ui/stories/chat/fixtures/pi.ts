// Pi の会話とツールの表示状態。送信内容や承認結果から状態を導出しない。
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { createBuiltinUiRegistry } from "../../../../../src/extension/ui-contributions/builtinContributions";

/** 独立した Pi の表示状態を作る。 */
export function piState(
	run: ChatState["run"] = "idle",
	showTools = false,
): ChatState {
	const state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "pi-story",
		sessionTitle: "Pi",
		cwd: "workspace/project",
		attachmentsSupported: false,
		run,
		configOptions: [
			{
				id: "model",
				name: "Pi Model",
				currentValue: "local/smoke",
				options: [],
			},
		],
	};
	state.uiContributions = createBuiltinUiRegistry().resolve(state, {
		backend: "pi",
		provider: "local",
		capabilities: ["model"],
	});
	if (run !== "idle") {
		state.runId = "pi-story-run";
		state.messages = [
			{
				id: "pi-user",
				role: "user",
				order: 1,
				text: "ファイルを確認してください",
			},
			{
				id: "pi-answer",
				role: "assistant",
				order: 4,
				text: "Piからの応答です。ワークスペースのファイルを読み取り、内容を確認しました。",
				streaming: run === "running",
			},
		];
	}
	if (run === "completed") {
		state.usage = { used: 60000, size: 200000 };
	}
	if (showTools) {
		state.tools = [
			{
				id: "pi-list",
				runId: "pi-story-run",
				order: 2,
				title: "フォルダーを確認: src",
				kind: "list",
				status: "completed",
				paths: ["src"],
				content: [
					{
						type: "content",
						content: {
							type: "text",
							text: "extension/\nshared/\nwebview/",
						},
					},
				],
			},
			{
				id: "pi-read",
				runId: "pi-story-run",
				order: 3,
				title: "ファイルを読む: src/長いディレクトリ名の折り返しを確認するためのフォルダー/README.md",
				kind: "read",
				status: "completed",
				rawInput: { offset: 1, limit: 20 },
				paths: [
					"src/長いディレクトリ名の折り返しを確認するためのフォルダー/README.md",
				],
				content: [
					{
						type: "content",
						content: {
							type: "text",
							text: "# Piツール表示\n本文の表示を確認しました。\n<script>これはファイルの内容です</script>",
						},
					},
				],
			},
		];
	}
	return state;
}
