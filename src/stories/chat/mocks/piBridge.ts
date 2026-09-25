// Pi 最小版の通信状態だけを再現し、実 SDK の検証は Host の疎通テストへ分離する。
import { initialState } from "../../../shared/chatState";
import type { HostMessage } from "../../../shared/messages";
import type { Bridge } from "../../../webview/vscodeBridge";
import { createBuiltinUiRegistry } from "../../../extension/ui-contributions/builtinContributions";

/** 未対応機能を持たない Pi で、逐次応答・Stop・再送を観察する。 */
export function createPiBridge(showTools = false): Bridge {
	let state = {
		...initialState(),
		connection: "ready" as const,
		sessionId: "pi-story",
		sessionTitle: "Pi",
		cwd: "D:/workspace/project",
		attachmentsSupported: false,
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
	const listeners = new Set<(event: HostMessage) => void>();
	let timer: ReturnType<typeof setInterval> | undefined;
	const emit = (event: HostMessage) => {
		for (const listener of listeners) {
			listener(event);
		}
	};
	const patch = (changes: Partial<typeof state>) => {
		state = { ...state, ...changes, revision: state.revision + 1 };
		emit({ type: "state/patch", revision: state.revision, patch: changes });
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				if (!listeners.size) {
					clearInterval(timer);
				}
			};
		},
		postMessage(message) {
			if (message.type === "ui/ready") {
				emit({ type: "state/snapshot", state });
			} else if (message.type === "prompt/send") {
				if (state.run === "running") {
					emit({
						type: "request/failed",
						requestId: message.requestId,
						error: "Piの実行が終わってから送信してください。追加指示は後続対応です。",
					});
					return;
				}
				const runId = crypto.randomUUID();
				const order = Math.max(
					state.revision,
					...[...state.messages, ...state.tools].map(
						(item) => item.order ?? 0,
					),
				);
				const missing = message.text.includes("missing");
				const file = missing
					? "missing.txt"
					: "src/長いディレクトリ名の折り返しを確認するためのフォルダー/README.md";
				patch({
					run: "running",
					runId,
					...(showTools
						? {
								tools: [
									...state.tools,
									{
										id: crypto.randomUUID(),
										runId,
										order: order + 2,
										title: "フォルダーを確認: src",
										kind: "list",
										status: "completed",
										paths: ["src"],
										rawInput: { path: "src", limit: 100 },
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
										id: crypto.randomUUID(),
										runId,
										order: order + 3,
										title: `ファイルを読む: ${file}`,
										kind: "read",
										status: "in_progress",
										paths: [file],
										rawInput: {
											path: file,
											offset: 1,
											limit: 20,
										},
										content: [],
									},
								],
							}
						: {}),
					messages: [
						...state.messages,
						{
							id: crypto.randomUUID(),
							role: "user",
							order: order + 1,
							text: message.text,
						},
						{
							id: crypto.randomUUID(),
							role: "assistant",
							order: order + 4,
							text: "",
							streaming: true,
						},
					],
				});
				emit({
					type: "prompt/accepted",
					requestId: message.requestId,
					mode: "start",
				});
				const text =
					"Piからの応答です。ワークスペースのファイルを読み取り、内容を確認しました。";
				let length = 0;
				timer = setInterval(() => {
					length++;
					const done = length >= text.length;
					patch({
						run: done ? "completed" : "running",
						...(done
							? { usage: { used: 60000, size: 200000 } }
							: {}),
						...(showTools && done
							? {
									tools: state.tools.map((tool) =>
										tool.runId === runId &&
										tool.status === "in_progress"
											? {
													...tool,
													status: missing
														? "failed"
														: "completed",
													content: [
														{
															type: "content",
															content: {
																type: "text",
																text: missing
																	? "ENOENT: ファイルが見つかりません: missing.txt"
																	: "# Piツール表示\n本文の表示を確認しました。\n<script>これはファイルの内容です</script>",
															},
														},
													],
												}
											: tool,
									),
								}
							: {}),
						messages: state.messages.map((item, index) =>
							index === state.messages.length - 1
								? {
										...item,
										text: text.slice(0, length),
										streaming: !done,
									}
								: item,
						),
					});
					if (done) {
						clearInterval(timer);
					}
				}, 70);
			} else if (message.type === "prompt/cancel") {
				clearInterval(timer);
				patch({
					run: "cancelled",
					tools: state.tools.map((tool) =>
						tool.runId === state.runId &&
						tool.status === "in_progress"
							? { ...tool, status: "cancelled" }
							: tool,
					),
					messages: state.messages.map((item) => ({
						...item,
						streaming: false,
					})),
				});
			} else if (message.type === "session/new") {
				clearInterval(timer);
				patch({
					sessionId: crypto.randomUUID(),
					run: "idle",
					usage: null,
					runId: null,
					messages: [],
					tools: [],
				});
			}
		},
	};
}
